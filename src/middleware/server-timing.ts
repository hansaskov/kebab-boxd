import type { DatabaseRpc } from "@src/db/remote";

// How long a request waited for the database, which the browser shows under Timing in its developer tools. Each
// call is a trip to the Durable Object, so the time grows with the trips the page waits for one after another.
//
// A Worker's clock only moves while it waits for something outside, such as the database, so the times are of the
// waits. Calls at the same time count once.

// Whether the Worker has answered a request yet. Cloudflare starts a Worker for the first request it gets, which
// loads all its code before the request can begin, and keeps it for those after.
let hasStarted = false;

// The Server-Timing entry that tells the request waited for the Worker to start, or undefined when the Worker ran
// already. It has no time: the start comes before the request, and the clock of a Worker stands still while it works.
export function coldStartTiming(): string | undefined {
	const isColdStart = !hasStarted;
	hasStarted = true;
	return isColdStart ? 'app;desc="cold start"' : undefined;
}

export function measuringDatabase(rpc: DatabaseRpc) {
	let calls = 0;
	let trips = 0;
	let running = 0;
	let waitingSince = 0;
	let waitedMs = 0;
	let wokeUp = false;

	const measured: DatabaseRpc = {
		async call(area, method, args) {
			calls++;
			if (running++ === 0) {
				trips++;
				waitingSince = performance.now();
			}
			try {
				const reply = await rpc.call(area, method, args);
				wokeUp ||= reply.wokeUp;
				return reply;
			} finally {
				if (--running === 0) waitedMs += performance.now() - waitingSince;
			}
		},
	};

	return {
		rpc: measured,
		// The Server-Timing header of the response.
		header: () => `db;dur=${waitedMs.toFixed(1)};desc="${trips} trips, ${calls} calls${wokeUp ? ", the database woke up" : ""}"`,
	};
}
