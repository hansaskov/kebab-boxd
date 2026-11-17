import { z } from "astro/zod";
import type { SubmittedForm } from "@src/actions/outcome";

interface FieldSource {
	id?: string | null | undefined;
	name: string;
	description?: string | undefined;
	errors?: string[] | undefined;
	submitted?: SubmittedForm | undefined;
}

export function describeField({ id, name, description, errors, submitted }: FieldSource) {
	const fieldId = id ?? name;
	const shown = errors ?? submitted?.errors(name) ?? [];
	const labelId = `${fieldId}-label`;
	const descriptionId = `${fieldId}-description`;
	const errorId = `${fieldId}-error`;
	return {
		id: fieldId,
		labelId,
		descriptionId,
		errorId,
		errors: shown,
		control: {
			id: fieldId,
			name,
			"aria-describedby": [description && descriptionId, shown.length > 0 && errorId].filter(Boolean).join(" ") || undefined,
			"aria-invalid": shown.length > 0 ? ("true" as const) : undefined,
		},
	};
}

export type DescribedField = ReturnType<typeof describeField>;

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
