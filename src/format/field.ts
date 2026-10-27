import type { SubmittedForm } from "@src/actions/outcome";

interface FieldSource {
	id?: string | null | undefined;
	name: string;
	description?: string | undefined;
	errors?: string[] | undefined;
	submitted?: SubmittedForm | undefined;
}

// The ids that tie a control to its label, description and errors, and the attributes of the control that refer to them.
// The errors are the ones given or, without them, the ones the failed form had for the field.
export function describeField({ id, name, description, errors, submitted }: FieldSource) {
	const fieldId = id ?? name;
	const shown = errors ?? submitted?.errors(name) ?? [];
	const descriptionId = `${fieldId}-description`;
	const errorId = `${fieldId}-error`;
	return {
		id: fieldId,
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
