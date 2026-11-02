/// <reference types="@cloudflare/workers-types" />

declare namespace App {
	interface Locals {
		db: import("@src/db").Database;
		session: import("@src/auth/session").SessionWithUser;
		actionOutcome?: import("@src/actions/outcome").ActionOutcome | undefined;
	}
}

// The migrations that drizzle-kit writes are bundled as text.
declare module "*.sql" {
	const sql: string;
	export default sql;
}
