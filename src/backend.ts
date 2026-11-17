import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import type { Database } from "@src/db";
import { openDurableDatabase, type CallReport } from "@src/db/durable-object";
import { callDatabaseAll, type DatabaseCall, type DatabaseReply, type DatabaseRpc } from "@src/db/remote";
import { createPictureStore } from "@src/pictures/store";
import { processDueWork } from "@src/background-work";

interface Env {
	Database: DurableObjectNamespace<DatabaseObject>;
	Pictures: R2Bucket;
	Images: ImagesBinding;
}

const logCall: CallReport = (call, rows) => {
	if (rows.rowsRead > 0 || rows.rowsWritten > 0) console.log({ message: "Database call", call, ...rows });
};

const purgeIntervalMs = 60 * 60 * 1000;
const nextPurgeKey = "nextPurgeAt";

export class DatabaseObject extends DurableObject<Env> {
	readonly #db: Database;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#db = openDurableDatabase(ctx.storage, createPictureStore(env.Pictures, env.Images), logCall);
		this.#db.onWork(() => void ctx.storage.setAlarm(Date.now()));
		void ctx.blockConcurrencyWhile(async () => {
			if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now());
		});
	}

	#hasAnswered = false;

	async call(calls: DatabaseCall[]): Promise<DatabaseReply> {
		const wokeUp = !this.#hasAnswered;
		this.#hasAnswered = true;
		return { values: await callDatabaseAll(this.#db, calls), wokeUp };
	}

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

		const nextWorkAt = (await processDueWork(this.#db))?.getTime() ?? Number.POSITIVE_INFINITY;
		await this.ctx.storage.setAlarm(Math.min(kv.get<number>(nextPurgeKey)!, nextWorkAt));
	}
}

export default class Backend extends WorkerEntrypoint<Env> implements DatabaseRpc {
	call(calls: DatabaseCall[]): Promise<DatabaseReply> {
		return this.env.Database.getByName("main").call(calls);
	}
}
