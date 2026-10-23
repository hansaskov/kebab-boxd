declare namespace App {
	interface Locals {
		db: import("@src/db").Database;
		session: import("@src/auth/session").SessionWithUser;
		submittedAction?: import("@src/actions/submitted-input").SubmittedAction | undefined;
	}
}
