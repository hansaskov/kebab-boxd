const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_CONSTRAINT = 19;
const SQLITE_CONSTRAINT_CHECK = 275;
const SQLITE_CONSTRAINT_FOREIGN_KEY = 787;
const SQLITE_CONSTRAINT_NOT_NULL = 1299;
const SQLITE_CONSTRAINT_PRIMARY_KEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

type SQLiteError = Error & {
	code: "ERR_SQLITE_ERROR";
	errcode: number;
	errstr: string;
};

function getSQLiteError(error: unknown) {
	const visited = new Set<unknown>();
	let current = error;

	while (
		typeof current === "object" &&
		current !== null &&
		!visited.has(current)
	) {
		visited.add(current);
		const candidate = current as Partial<SQLiteError>;

		if (
			candidate.code === "ERR_SQLITE_ERROR" &&
			typeof candidate.errcode === "number" &&
			typeof candidate.errstr === "string"
		) {
			return current as SQLiteError;
		}

		current = (current as { cause?: unknown }).cause;
	}

	return undefined;
}

export function isSQLiteError(error: unknown) {
	return getSQLiteError(error) !== undefined;
}

function hasSQLiteCode(error: unknown, code: number) {
	const sqliteError = getSQLiteError(error);
	return sqliteError !== undefined && (sqliteError.errcode & 0xff) === code;
}

export function isConstraintError(error: unknown) {
	return hasSQLiteCode(error, SQLITE_CONSTRAINT);
}

export function isUniqueConstraintError(error: unknown) {
	return getSQLiteError(error)?.errcode === SQLITE_CONSTRAINT_UNIQUE;
}

export function isPrimaryKeyConstraintError(error: unknown) {
	return getSQLiteError(error)?.errcode === SQLITE_CONSTRAINT_PRIMARY_KEY;
}

export function isNotNullConstraintError(error: unknown) {
	return getSQLiteError(error)?.errcode === SQLITE_CONSTRAINT_NOT_NULL;
}

export function isCheckConstraintError(error: unknown) {
	return getSQLiteError(error)?.errcode === SQLITE_CONSTRAINT_CHECK;
}

export function isForeignKeyConstraintError(error: unknown) {
	return getSQLiteError(error)?.errcode === SQLITE_CONSTRAINT_FOREIGN_KEY;
}

export function isBusyError(error: unknown) {
	return hasSQLiteCode(error, SQLITE_BUSY);
}

export function isLockedError(error: unknown) {
	return hasSQLiteCode(error, SQLITE_LOCKED);
}

export function isReadonlyError(error: unknown) {
	return hasSQLiteCode(error, SQLITE_READONLY);
}
