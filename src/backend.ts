import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import type { Database } from "@src/db";
import { openDurableDatabase } from "@src/db/durable-object";
import { callDatabase, type DatabaseRpc } from "@src/db/remote";
import { createPictureStore } from "@src/pictures/store";
import { processDueSuggestions } from "@src/suggestion-queue";

// The bindings that sst.config.ts gives the Backend Worker.
interface Env {
	Database: DurableObjectNamespace<DatabaseObject>;
	Pictures: R2Bucket;
	Images: ImagesBinding;
}

const purgeIntervalMs = 60 * 60 * 1000;
const nextPurgeKey = "nextPurgeAt";

// All data lives in one Durable Object, so every request sees the same database. Its storage is SQLite, and
// each write runs in a synchronous transaction, one at a time.
export class DatabaseObject extends DurableObject<Env> {
	readonly #db: Database;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#db = openDurableDatabase(ctx.storage, createPictureStore(env.Pictures, env.Images));
		this.#db.suggestionQueue.onQueued(() => void ctx.storage.setAlarm(Date.now()));
		void ctx.blockConcurrencyWhile(async () => {
			if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now());
		});
	}

	call(area: string, method: string, args: unknown[]) {
		return callDatabase(this.#db, area, method, args);
	}

	// Runs the suggestion queue and the hourly purge of expired personal data, then sleeps until one is due again.
	override async alarm() {
		const { kv } = this.ctx.storage;
		const now = Date.now();

		if ((kv.get<number>(nextPurgeKey) ?? 0) <= now) {
			try {
				await this.#db.retention.purge(new Date(now));
			} catch (error) {
				console.error("Could not purge expired personal data", error);
			}
			kv.put(nextPurgeKey, now + purgeIntervalMs);
		}

		const nextSuggestionAt = (await processDueSuggestions(this.#db))?.getTime() ?? Number.POSITIVE_INFINITY;
		await this.ctx.storage.setAlarm(Math.min(kv.get<number>(nextPurgeKey)!, nextSuggestionAt));
	}
}

// The website calls the database through this entrypoint, which hands each call to the Durable Object.
export default class Backend extends WorkerEntrypoint<Env> implements DatabaseRpc {
	call(area: string, method: string, args: unknown[]) {
		return this.env.Database.getByName("main").call(area, method, args);
	}
}
