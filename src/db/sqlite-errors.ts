import { isErrorContainer, isSQLiteError } from "@src/validation/type-guards";

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_CONSTRAINT = 19;
const SQLITE_CONSTRAINT_CHECK = 275;
const SQLITE_CONSTRAINT_FOREIGN_KEY = 787;
const SQLITE_CONSTRAINT_NOT_NULL = 1299;
const SQLITE_CONSTRAINT_PRIMARY_KEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

export type SQLiteError = Error & {
	code: "ERR_SQLITE_ERROR";
	errcode: number;
	errstr: string;
};

/** Walk the cause chain of an untrusted error and return the nearest SQLite error. */
export function getSQLiteError(cause: unknown) {
	const visited = new Set<object>();
	let current: unknown = cause;

	while (isErrorContainer(current) && !visited.has(current)) {
		visited.add(current);
		if (isSQLiteError(current)) {
			return current;
		}
		current = current.cause;
	}

	return undefined;
}

function hasSQLiteCode(sqlite: SQLiteError | undefined, code: number) {
	return sqlite !== undefined && (sqlite.errcode & 0xff) === code;
}

export function isConstraintError(sqlite: SQLiteError | undefined) {
	return hasSQLiteCode(sqlite, SQLITE_CONSTRAINT);
}

export function isUniqueConstraintError(sqlite: SQLiteError | undefined) {
	return sqlite?.errcode === SQLITE_CONSTRAINT_UNIQUE;
}

export function isPrimaryKeyConstraintError(sqlite: SQLiteError | undefined) {
	return sqlite?.errcode === SQLITE_CONSTRAINT_PRIMARY_KEY;
}

export function isNotNullConstraintError(sqlite: SQLiteError | undefined) {
	return sqlite?.errcode === SQLITE_CONSTRAINT_NOT_NULL;
}

export function isCheckConstraintError(sqlite: SQLiteError | undefined) {
	return sqlite?.errcode === SQLITE_CONSTRAINT_CHECK;
}

export function isForeignKeyConstraintError(sqlite: SQLiteError | undefined) {
	return sqlite?.errcode === SQLITE_CONSTRAINT_FOREIGN_KEY;
}

export function isBusyError(sqlite: SQLiteError | undefined) {
	return hasSQLiteCode(sqlite, SQLITE_BUSY);
}

export function isLockedError(sqlite: SQLiteError | undefined) {
	return hasSQLiteCode(sqlite, SQLITE_LOCKED);
}

export function isReadonlyError(sqlite: SQLiteError | undefined) {
	return hasSQLiteCode(sqlite, SQLITE_READONLY);
}
