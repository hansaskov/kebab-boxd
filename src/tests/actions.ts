import { getActionContext } from "astro:actions";
import type { APIContext } from "astro";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";

export function actionContext(db: Database, session: SessionWithUser) {
	const context = { locals: { db, session } };
	Reflect.set(context, Symbol.for("astro.actionAPIContext"), true);
	return context;
}

export function form(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		formData.set(name, value);
	}
	return formData;
}

type ActionResult = Parameters<ReturnType<typeof getActionContext>["serializeActionResult"]>[0];

export function withActionResult(locals: App.Locals, actionName: string, result: ActionResult) {
	const url = new URL("http://localhost/");
	const context = { locals, url, request: new Request(url), routePattern: url.pathname } as unknown as APIContext;
	const { setActionResult, serializeActionResult } = getActionContext(context);
	setActionResult(actionName, serializeActionResult(result));
	return locals;
}
