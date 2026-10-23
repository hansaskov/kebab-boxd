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
