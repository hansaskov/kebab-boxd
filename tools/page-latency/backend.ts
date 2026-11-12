import { drizzle } from "drizzle-orm/durable-sqlite";
import Backend, { DatabaseObject } from "@src/backend";
import { createSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { relations } from "@src/db/relations";
import { fillLargeDatabase, type LargeDatabase } from "@src/tests/large-database";

// The Backend Worker of production, with what the measurement needs around it: a large database, sessions to sign
// in with, the time each call takes to reach the Durable Object, and a record of the calls of each request.

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

// Milliseconds a call takes to travel to the Durable Object and back. The measurement sets it.
let roundTripMs = 0;

// The calls since the measurement last asked for them. Every request of the measurement runs alone, so they are
// the calls of that request.
let calls: CallRecord[] = [];

export class BenchDatabase extends DatabaseObject {
	async fill(scale: number): Promise<Bench> {
		const subjects = await fillLargeDatabase(drizzle(this.ctx.storage, { relations }), scale);
		const sessions: Pick<Database["sessions"], "create"> = { create: async (session) => void (await this.call("sessions", "create", [session])) };
		const signIn = async (userId: number) => (await createSession({ sessions } as Database, userId)).token;
		return {
			subjects,
			tokens: { viewer: await signIn(subjects.viewerId), author: await signIn(subjects.authorId), admin: await signIn(subjects.adminId) },
		};
	}
}

// What the Web Worker calls. It waits out the trip to the Durable Object before each call, as the network does.
export class DelayedBackend extends Backend {
	override async call(area: string, method: string, args: unknown[]) {
		const startedAt = Date.now();
		if (roundTripMs > 0) await scheduler.wait(roundTripMs);
		try {
			return await super.call(area, method, args);
		} finally {
			calls.push({ call: `${area}.${method}`, startedAt, endedAt: Date.now() });
		}
	}
}

// The measurement fills the database, sets the trip and reads the calls through fetch, which Node can reach.
export default {
	async fetch(request: Request, env: BenchEnv) {
		const url = new URL(request.url);
		switch (url.pathname) {
			case "/fill":
				return Response.json(await env.Database.getByName("main").fill(Number(url.searchParams.get("scale"))));
			case "/round-trip":
				roundTripMs = Number(url.searchParams.get("ms"));
				return new Response(null, { status: 204 });
			case "/calls": {
				const taken = calls;
				calls = [];
				return Response.json(taken);
			}
			default:
				return new Response(null, { status: 404 });
		}
	},
};
