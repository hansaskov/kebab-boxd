import type { ActionError } from "astro:actions";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import { outcomeOf, toSubmittedInput } from "@src/actions/outcome";

export function actionContext(db: Database, session: SessionWithUser) {
	const context = { locals: { db, session } };
	Reflect.set(context, Symbol.for("astro.actionAPIContext"), true);
	return context;
}

type FormValue = string | number | File;

export function form(fields: Record<string, FormValue | FormValue[]>) {
	const formData = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			formData.append(name, typeof item === "number" ? String(item) : item);
		}
	}
	return formData;
}

// Replays what the middleware keeps of a form submission for the page the user is sent to next.
export function withActionResult(locals: App.Locals, actionName: string, result: { error?: ActionError | undefined }, submitted?: FormData) {
	locals.actionOutcome = outcomeOf(actionName, result.error, submitted ? toSubmittedInput(submitted) : []);
	return locals;
}
