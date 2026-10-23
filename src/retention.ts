import type { Database } from "@src/db";

const purgeIntervalMs = 60 * 60 * 1000;

export function scheduleRetentionPurge(db: Database) {
	const purge = () => {
		db.mutations.retention.purge(new Date()).catch((error: unknown) => {
			console.error("Could not purge expired personal data", error);
		});
	};

	purge();
	const timer = setInterval(purge, purgeIntervalMs).unref();

	return () => clearInterval(timer);
}
