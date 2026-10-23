import { getActionContext } from "astro:actions";
import type { APIContext } from "astro";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import { toSubmittedInput } from "@src/actions/submitted-input";

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

type ActionResult = Parameters<ReturnType<typeof getActionContext>["serializeActionResult"]>[0];

// Replays what the middleware keeps of a form submission for the page the user is sent to next.
export function withActionResult(locals: App.Locals, actionName: string, result: ActionResult, submitted?: FormData) {
	const url = new URL("http://localhost/");
	const context = { locals, url, request: new Request(url), routePattern: url.pathname } as unknown as APIContext;
	const { setActionResult, serializeActionResult } = getActionContext(context);
	setActionResult(actionName, serializeActionResult(result));
	if (submitted) locals.submittedAction = { actionName, input: toSubmittedInput(submitted) };
	return locals;
}
