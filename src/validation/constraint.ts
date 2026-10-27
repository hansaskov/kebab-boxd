import { z } from "astro/zod";

export type InputConstraint = Partial<{
	pattern: string;
	title: string;
	min: number;
	max: number;
	required: boolean;
	minlength: number;
	maxlength: number;
}>;

const flagsBrowsersCannotApply = /[ims]/;

// The first regex that a browser can check too, with its message as the title the browser shows.
function patternOf(schema: z.ZodString): Pick<InputConstraint, "pattern" | "title"> {
	for (const check of schema.def.checks ?? []) {
		const def = check._zod.def as z.core.$ZodCheckStringFormatDef;
		if (def.check !== "string_format" || def.format !== "regex" || !def.pattern) continue;
		if (flagsBrowsersCannotApply.test(def.pattern.flags)) continue;
		const message = def.error?.({ code: "invalid_format", format: "regex", input: "" } as never);
		const title = typeof message === "string" ? message : message?.message;
		return { pattern: def.pattern.source, ...(title && { title }) };
	}
	return {};
}

// The attributes that let the browser check a field as the schema does, before the form is sent.
export function getConstraintsFromZodSchema(schema: z.ZodType): InputConstraint {
	let inner = schema;
	let required = true;
	while (inner instanceof z.ZodNullable || inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
		inner = inner.unwrap() as z.ZodType;
		required = false;
	}

	const output: InputConstraint = { required };
	if (inner instanceof z.ZodString) {
		if (inner.minLength !== null) output.minlength = inner.minLength;
		if (inner.maxLength !== null) output.maxlength = inner.maxLength;
		Object.assign(output, patternOf(inner));
	} else if (inner instanceof z.ZodNumber) {
		if (Number.isFinite(inner.minValue)) output.min = inner.minValue!;
		if (Number.isFinite(inner.maxValue)) output.max = inner.maxValue!;
	}
	return output;
}
