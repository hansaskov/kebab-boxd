import { drizzle } from "drizzle-orm/durable-sqlite";
import { DatabaseObject } from "@src/backend";
import { createSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { relations } from "@src/db/relations";
import { fillLargeDatabase, type LargeDatabase } from "@src/tests/large-database";

interface BenchEnv {
	Database: DurableObjectNamespace<BenchDatabase>;
}

export interface CallRecord {
	call: string;
	startedAt: number;
	endedAt: number;
}

export interface Bench {
	subjects: LargeDatabase;
	tokens: Record<"viewer" | "author" | "admin", string>;
}

export class BenchDatabase extends DatabaseObject {
	#roundTripMs = 0;
	#calls: CallRecord[] = [];

	async fill(scale: number): Promise<Bench> {
		const subjects = await fillLargeDatabase(drizzle(this.ctx.storage, { relations }), scale);
		const sessions: Pick<Database["sessions"], "create"> = { create: async (session) => void (await super.call("sessions", "create", [session])) };
		const signIn = async (userId: number) => (await createSession({ sessions } as Database, userId)).token;
		return {
			subjects,
			tokens: { viewer: await signIn(subjects.viewerId), author: await signIn(subjects.authorId), admin: await signIn(subjects.adminId) },
		};
	}

	setRoundTrip(ms: number) {
		this.#roundTripMs = ms;
	}

	takeCalls() {
		const taken = this.#calls;
		this.#calls = [];
		return taken;
	}

	override async call(area: string, method: string, args: unknown[]) {
		const startedAt = Date.now();
		if (this.#roundTripMs > 0) await scheduler.wait(this.#roundTripMs);
		try {
			return await super.call(area, method, args);
		} finally {
			this.#calls.push({ call: `${area}.${method}`, startedAt, endedAt: Date.now() });
		}
	}
}

export default {
	async fetch(request: Request, env: BenchEnv) {
		const url = new URL(request.url);
		const database = env.Database.getByName("main");
		switch (url.pathname) {
			case "/fill":
				return Response.json(await database.fill(Number(url.searchParams.get("scale"))));
			case "/round-trip":
				await database.setRoundTrip(Number(url.searchParams.get("ms")));
				return new Response(null, { status: 204 });
			case "/calls":
				return Response.json(await database.takeCalls());
			default:
				return new Response(null, { status: 404 });
		}
	},
};
