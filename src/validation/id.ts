import { z } from "astro/zod";

export const idSchema = z.number().int().positive();

export function parseId(param: string | undefined): number | undefined {
	if (!param || !/^[1-9]\d*$/.test(param)) return undefined;
	const id = Number(param);
	return Number.isSafeInteger(id) ? id : undefined;
}
