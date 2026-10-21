import type { z } from "astro/zod";

import { isCheckDef, isNumber, isWrapperDef } from "@src/validation/type-guards";

export type InputConstraint = Partial<{
	pattern: string;
	title: string;
	min: number | string;
	max: number | string;
	required: boolean;
	step: number | "any";
	minlength: number;
	maxlength: number;
}>;

export type CheckDef =
	| z.core.$ZodCheckMinLengthDef
	| z.core.$ZodCheckMaxLengthDef
	| z.core.$ZodCheckLengthEqualsDef
	| z.core.$ZodCheckGreaterThanDef
	| z.core.$ZodCheckLessThanDef
	| z.core.$ZodCheckMultipleOfDef
	| z.core.$ZodCheckNumberFormatDef
	| z.core.$ZodCheckStringFormatDef;

type ZodInfo = {
	def: z.core.$ZodTypeDef;
	isNullable: boolean;
	isOptional: boolean;
	checks: CheckDef[];
};

function zodInfo(schema: z.ZodType): ZodInfo {
	let isNullable = false;
	let isOptional = false;
	const checks: CheckDef[] = [];

	while (true) {
		const def = schema.def;

		if ("check" in def) {
			const checkDef = def as z.core.$ZodCheckDef;
			if (isCheckDef(checkDef)) {
				checks.push(checkDef);
			}
		}
		for (const check of def.checks ?? []) {
			const checkDef = check._zod.def;
			if (isCheckDef(checkDef)) {
				checks.push(checkDef);
			}
		}

		if (def.type === "optional" || def.type === "default") {
			isOptional = true;
		} else if (def.type === "nullable") {
			isNullable = true;
		}

		if (!isWrapperDef(def)) {
			return { def, isNullable, isOptional, checks };
		}

		schema = def.innerType as z.ZodType;
	}
}

/**
 * Browsers compile `pattern` with the `v` flag and nothing else, so a regex
 * that relies on these flags would match differently in the browser.
 */
const flagsBrowsersCannotApply = /[ims]/;

/** The custom message given to a check, such as the second argument of `.regex()`. */
function customMessage(check: z.core.$ZodCheckStringFormatDef): string | undefined {
	const result = check.error?.({
		code: "invalid_format",
		format: check.format,
		pattern: check.pattern?.source,
		input: "",
	} as never);
	return typeof result === "string" ? result : (result?.message ?? undefined);
}

export function getConstraintsFromZodSchema(schema: z.ZodType): InputConstraint | undefined {
	const output: InputConstraint = {};
	const { def, checks, isNullable, isOptional } = zodInfo(schema);

	if (def.type === "string") {
		for (const check of checks) {
			switch (check.check) {
				case "min_length":
					if (output.minlength === undefined || check.minimum > output.minlength) {
						output.minlength = check.minimum;
					}
					break;
				case "max_length":
					if (output.maxlength === undefined || check.maximum < output.maxlength) {
						output.maxlength = check.maximum;
					}
					break;
				case "length_equals":
					output.minlength = check.length;
					output.maxlength = check.length;
					break;
				case "string_format":
					if (
						check.format === "regex" &&
						check.pattern &&
						!flagsBrowsersCannotApply.test(check.pattern.flags) &&
						output.pattern === undefined
					) {
						output.pattern = check.pattern.source;
						const title = customMessage(check);
						if (title !== undefined) {
							output.title = title;
						}
					}
					break;
			}
		}
	} else if (def.type === "number" || def.type === "int") {
		const isInt = checks.some(
			(check) => check.check === "number_format" && check.format.includes("int"),
		);

		for (const check of checks) {
			switch (check.check) {
				case "greater_than":
					if (isNumber(check.value)) {
						const min = check.inclusive
							? check.value
							: check.value + (isInt ? 1 : Number.MIN_VALUE);
						if (!isNumber(output.min) || min > output.min) {
							output.min = min;
						}
					}
					break;
				case "less_than":
					if (isNumber(check.value)) {
						const max = check.inclusive
							? check.value
							: check.value - (isInt ? 1 : Number.MIN_VALUE);
						if (!isNumber(output.max) || max < output.max) {
							output.max = max;
						}
					}
					break;
				case "multiple_of":
					if (isNumber(check.value)) {
						output.step = check.value;
					}
					break;
			}
		}
	} else if (def.type === "date") {
		for (const check of checks) {
			switch (check.check) {
				case "greater_than":
					if (check.value instanceof Date) {
						output.min = check.value.toISOString();
					}
					break;
				case "less_than":
					if (check.value instanceof Date) {
						output.max = check.value.toISOString();
					}
					break;
			}
		}
	} else if (def.type === "array") {
		for (const check of checks) {
			switch (check.check) {
				case "min_length":
					if (!isNumber(output.min) || check.minimum > output.min) {
						output.min = check.minimum;
					}
					break;
				case "max_length":
					if (!isNumber(output.max) || check.maximum < output.max) {
						output.max = check.maximum;
					}
					break;
				case "length_equals":
					output.min = check.length;
					output.max = check.length;
					break;
			}
		}
	}

	if (!isNullable && !isOptional) {
		output.required = true;
	}

	return Object.keys(output).length > 0 ? output : undefined;
}
