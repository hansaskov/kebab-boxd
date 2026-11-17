/// <reference types="@cloudflare/workers-types" />

declare namespace App {
	interface Locals {
		db: import("@src/db/remote").RemoteDatabase;
		session: import("@src/auth/session").SessionWithUser;
		actionOutcome?: import("@src/actions/outcome").ActionOutcome | undefined;
	}
}

// The Durable Object of the Backend Worker, which sst.config.ts binds to the Web Worker in production only.
declare namespace Cloudflare {
	interface Env {
		Database?: DurableObjectNamespace<import("@src/backend").DatabaseObject>;
	}
}

// The migrations that drizzle-kit writes are bundled as text.
declare module "*.sql" {
	const sql: string;
	export default sql;
}
