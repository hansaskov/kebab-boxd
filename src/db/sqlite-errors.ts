const SQLITE_CONSTRAINT_UNIQUE = 2067;

// Drizzle wraps the error of the driver, so the chain of causes is searched for it.
export function isUniqueConstraintError(error: unknown) {
	const seen = new Set<unknown>();
	for (let cause = error; cause instanceof Object && !seen.has(cause); cause = (cause as { cause?: unknown }).cause) {
		seen.add(cause);
		if ("errcode" in cause && cause.errcode === SQLITE_CONSTRAINT_UNIQUE) return true;
	}
	return false;
}
