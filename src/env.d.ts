/// <reference types="@cloudflare/workers-types" />

declare namespace App {
	interface Locals {
		db: import("@src/db/remote").PageDatabase;
		session: () => Promise<import("@src/auth/sessions.db").SessionWithUser | null>;
		actionOutcome?: import("@src/actions/outcome").ActionOutcome | undefined;
	}
}

declare namespace Cloudflare {
	interface Env {
		Database?: DurableObjectNamespace<import("@src/backend").DatabaseObject>;
	}
}

declare module "*.sql" {
	const sql: string;
	export default sql;
}
