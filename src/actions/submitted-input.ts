export type SubmittedInput = [name: string, value: string][];

export interface SubmittedAction {
	actionName: string;
	input: SubmittedInput;
}

// The schemas allow far shorter values, so anything longer is not worth keeping in the session.
const maxValueLength = 10_000;
const maxFields = 100;

// Files are left out: they cannot be kept in the session, and a browser does not let a page fill in a file input.
// The fields Astro adds to a form are left out too.
export function toSubmittedInput(formData: FormData): SubmittedInput {
	return [...formData]
		.flatMap(([name, value]): SubmittedInput => (typeof value === "string" && !name.startsWith("_astro") ? [[name, value.slice(0, maxValueLength)]] : []))
		.slice(0, maxFields);
}

export async function readSubmittedInput(request: Request): Promise<SubmittedInput> {
	try {
		return toSubmittedInput(await request.formData());
	} catch {
		return [];
	}
}

export class SubmittedForm {
	constructor(private readonly input: SubmittedInput) {}

	get(name: string): string | undefined {
		return this.input.find(([field]) => field === name)?.[1];
	}

	getAll(name: string): string[] {
		return this.input.filter(([field]) => field === name).map(([, value]) => value);
	}
}

// What the user typed into the form of the action, when the action failed on the request before this one.
export function submittedForm(locals: App.Locals, action: { toString(): string }): SubmittedForm | undefined {
	const actionName = new URLSearchParams(action.toString()).get("_action");
	const submitted = locals.submittedAction;
	return submitted && submitted.actionName === actionName ? new SubmittedForm(submitted.input) : undefined;
}
