import { isInputError, type ActionError } from "astro:actions";

export type SubmittedInput = [name: string, value: string][];

export interface ActionFailure {
	code: string;
	message: string;
	fields: Partial<Record<string, string[]>>;
	input: SubmittedInput;
}

// What the middleware keeps of a form action for the page after it: which action ran and, when it failed,
// why and what the user typed.
export interface ActionOutcome {
	name: string;
	failure?: ActionFailure | undefined;
}

// The schemas allow far shorter values, so anything longer is not worth keeping in the session.
const maxValueLength = 10_000;
const maxFields = 100;

// Files are left out: they cannot be kept in the session, and a browser does not let a page fill in a file input.
// The fields Astro adds to a form are left out too. A body that is no form keeps nothing.
async function readSubmittedInput(request: Pick<Request, "formData">): Promise<SubmittedInput> {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return [];
	}
	return [...formData]
		.flatMap(([name, value]): SubmittedInput => (typeof value === "string" && !name.startsWith("_astro") ? [[name, value.slice(0, maxValueLength)]] : []))
		.slice(0, maxFields);
}

// The request is read only when the action failed, since only then is what the user typed shown again.
export async function toOutcome(name: string, error: ActionError | undefined, request: Pick<Request, "formData">): Promise<ActionOutcome> {
	if (!error) return { name };
	const fields = isInputError(error) ? error.fields : {};
	return { name, failure: { code: error.code, message: error.message, fields, input: await readSubmittedInput(request) } };
}

export class SubmittedForm {
	constructor(private readonly failure: ActionFailure) {}

	get code(): string {
		return this.failure.code;
	}

	get message(): string {
		return this.failure.message;
	}

	get hasFieldErrors(): boolean {
		return Object.keys(this.failure.fields).length > 0;
	}

	get(name: string): string | undefined {
		return this.failure.input.find(([field]) => field === name)?.[1];
	}

	getAll(name: string): string[] {
		return this.failure.input.filter(([field]) => field === name).map(([, value]) => value);
	}

	errors(name: string): string[] | undefined {
		return this.failure.fields[name];
	}
}

type Action = { toString(): string };

function nameOf(action: Action) {
	return new URLSearchParams(action.toString()).get("_action");
}

// What the user typed into the form of the action, and what was wrong with it, when it failed on the request before this one.
export function submittedForm(locals: App.Locals, action: Action): SubmittedForm | undefined {
	const outcome = locals.actionOutcome;
	return outcome?.failure && outcome.name === nameOf(action) ? new SubmittedForm(outcome.failure) : undefined;
}

export function succeeded(locals: App.Locals, action: Action): boolean {
	const outcome = locals.actionOutcome;
	return outcome !== undefined && !outcome.failure && outcome.name === nameOf(action);
}
