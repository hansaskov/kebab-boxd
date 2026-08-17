import type { z } from "astro/zod";

import type { SQLiteError } from "@src/db/sqlite-errors";
import type { ContentTypeFilter } from "@src/middleware/compress";
import type { CheckDef } from "@src/validation/constraint";

export function isNumber(value: number | string | bigint | Date | undefined): value is number {
	return Number.isFinite(value);
}

export function isFunction(value: ContentTypeFilter): value is (contentType: string) => boolean {
	return !(value instanceof RegExp);
}

export function hasStringRedirect(
	data: { redirect: string } | undefined,
): data is { redirect: string } {
	return data?.redirect !== undefined;
}

export function isErrorContainer(cause: unknown): cause is { cause?: unknown } {
	return cause !== null && cause instanceof Object;
}

export function isSQLiteError(cause: unknown): cause is SQLiteError {
	if (!isErrorContainer(cause)) {
		return false;
	}
	// SAFETY: cause is confirmed to be an object; its fields are validated below.
	const candidate = cause as Partial<SQLiteError>;
	return (
		candidate.code === "ERR_SQLITE_ERROR" &&
		Number.isFinite(candidate.errcode) &&
		candidate.errstr !== undefined
	);
}

export function isCheckDef(def: z.core.$ZodCheckDef): def is CheckDef {
	return "check" in def;
}

export type WrapperDef = z.core.$ZodOptionalDef | z.core.$ZodNullableDef | z.core.$ZodDefaultDef;

export function isWrapperDef(def: z.core.$ZodTypeDef): def is WrapperDef {
	return def.type === "optional" || def.type === "default" || def.type === "nullable";
}