import type { DatabaseRpc } from "@src/db/remote";

let hasStarted = false;

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
		async call(batch) {
			calls += batch.length;
			if (running++ === 0) {
				trips++;
				waitingSince = performance.now();
			}
			try {
				const reply = await rpc.call(batch);
				wokeUp ||= reply.wokeUp;
				return reply;
			} finally {
				if (--running === 0) waitedMs += performance.now() - waitingSince;
			}
		},
	};

	return {
		rpc: measured,
		header: () => `db;dur=${waitedMs.toFixed(1)};desc="${trips} trips, ${calls} calls${wokeUp ? ", the database woke up" : ""}"`,
	};
}
