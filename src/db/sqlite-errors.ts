const SQLITE_CONSTRAINT_UNIQUE = 2067;

function isUniqueViolation(error: object) {
	if ("errcode" in error) return error.errcode === SQLITE_CONSTRAINT_UNIQUE;
	return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

export function isUniqueConstraintError(error: unknown) {
	const seen = new Set<unknown>();
	for (let cause = error; cause instanceof Object && !seen.has(cause); cause = (cause as { cause?: unknown }).cause) {
		seen.add(cause);
		if (isUniqueViolation(cause)) return true;
	}
	return false;
}
