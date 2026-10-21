declare namespace App {
	interface Locals {
		db: import("@src/db").Database;
		session: import("@src/auth/session").SessionWithUser;
	}
}
