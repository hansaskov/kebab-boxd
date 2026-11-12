import { drizzle } from "drizzle-orm/durable-sqlite";
import { DatabaseObject } from "@src/backend";
import { createSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { relations } from "@src/db/relations";
import { fillLargeDatabase, type LargeDatabase } from "@src/tests/large-database";

// The Durable Object of production, with what the measurement needs around it: a large database, sessions to sign in
// with, the time each call takes to reach it, and a record of the calls of each request. The Web Worker calls it
// directly, as in production.

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
	// Milliseconds a call takes to travel to the Durable Object and back. The measurement sets it.
	#roundTripMs = 0;
	// The calls since the measurement last asked for them. Every request of the measurement runs alone, so they are
	// the calls of that request.
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

	// Waits out the trip to the Durable Object before each call, as the network does.
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

// The measurement fills the database, sets the trip and reads the calls through fetch, which Node can reach.
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
