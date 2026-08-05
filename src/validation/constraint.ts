// Heavily Inspired by https://raw.githubusercontent.com/ciscoheat/sveltekit-superforms/a1e0dbb96cde1c62f0b528b1323076359e913c2d/src/lib/jsonSchema/constraints.ts

import type { z } from "astro/zod";

export type InputConstraint = Partial<{
	pattern: string; // RegExp
	min: number | string; // Date
	max: number | string; // Date
	required: boolean;
	step: number | "any";
	minlength: number;
	maxlength: number;
}>;

type CheckDef =
	| z.core.$ZodCheckMinLengthDef
	| z.core.$ZodCheckMaxLengthDef
	| z.core.$ZodCheckLengthEqualsDef
	| z.core.$ZodCheckGreaterThanDef
	| z.core.$ZodCheckLessThanDef
	| z.core.$ZodCheckMultipleOfDef
	| z.core.$ZodCheckNumberFormatDef
	| z.core.$ZodCheckStringFormatDef;

type WrapperDef = z.core.$ZodOptionalDef | z.core.$ZodNullableDef | z.core.$ZodDefaultDef;

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
			checks.push(def as unknown as CheckDef);
		}
		for (const check of def.checks ?? []) {
			checks.push(check._zod.def as CheckDef);
		}

		if (def.type === "optional" || def.type === "default") {
			isOptional = true;
		} else if (def.type === "nullable") {
			isNullable = true;
		} else {
			return { def, isNullable, isOptional, checks };
		}

		schema = (def as WrapperDef).innerType as z.ZodType;
	}
}

export function constraint(schema: z.ZodType): InputConstraint | undefined {
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
					if (check.format === "regex" && check.pattern && output.pattern === undefined) {
						output.pattern = check.pattern.source;
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
					if (typeof check.value === "number") {
						const min = check.inclusive
							? check.value
							: check.value + (isInt ? 1 : Number.MIN_VALUE);
						if (typeof output.min !== "number" || min > output.min) {
							output.min = min;
						}
					}
					break;
				case "less_than":
					if (typeof check.value === "number") {
						const max = check.inclusive
							? check.value
							: check.value - (isInt ? 1 : Number.MIN_VALUE);
						if (typeof output.max !== "number" || max < output.max) {
							output.max = max;
						}
					}
					break;
				case "multiple_of":
					if (typeof check.value === "number") {
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
					if (typeof output.min !== "number" || check.minimum > output.min) {
						output.min = check.minimum;
					}
					break;
				case "max_length":
					if (typeof output.max !== "number" || check.maximum < output.max) {
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
