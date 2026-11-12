import type { DatabaseRpc } from "@src/db/remote";

// How long a request waited for the database, which the browser shows under Timing in its developer tools. Each
// call is a trip to the Durable Object, so the time grows with the trips the page waits for one after another.
//
// A Worker's clock only moves while it waits for something outside, such as the database, so the times are of the
// waits. Calls at the same time count once.

export function measuringDatabase(rpc: DatabaseRpc) {
	let calls = 0;
	let trips = 0;
	let running = 0;
	let waitingSince = 0;
	let waitedMs = 0;

	const measured: DatabaseRpc = {
		async call(area, method, args) {
			calls++;
			if (running++ === 0) {
				trips++;
				waitingSince = performance.now();
			}
			try {
				return await rpc.call(area, method, args);
			} finally {
				if (--running === 0) waitedMs += performance.now() - waitingSince;
			}
		},
	};

	return {
		rpc: measured,
		// The Server-Timing header of the response.
		header: () => `db;dur=${waitedMs.toFixed(1)};desc="${trips} trips, ${calls} calls"`,
	};
}
