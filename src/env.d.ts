declare namespace App {
	interface Locals {
		db: import("@src/db").DB;
		session: import("@src/auth/session").SessionWithUser | null;
	}
}
