import { drizzle } from "drizzle-orm/durable-sqlite";
import { DatabaseObject } from "@src/backend";
import { createSession } from "@src/auth/session";
import type { Database } from "@src/db";
import type { DatabaseRequest } from "@src/db/remote";
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
		const sessions: Pick<Database["sessions"], "create"> = {
			create: async (session) => void (await super.call({ calls: [{ area: "sessions", method: "create", args: [session] }] })),
		};
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

	override async call(request: DatabaseRequest) {
		const startedAt = Date.now();
		if (this.#roundTripMs > 0) await scheduler.wait(this.#roundTripMs);
		try {
			return await super.call(request);
		} finally {
			const endedAt = Date.now();
			const names = [...(request.session ? ["sessions.open"] : []), ...request.calls.map(({ area, method }) => `${area}.${method}`)];
			this.#calls.push(...names.map((call) => ({ call, startedAt, endedAt })));
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
