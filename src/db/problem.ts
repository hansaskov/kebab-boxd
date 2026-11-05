import type { Refusal, ResourcePermission, SubjectPermission } from "@src/auth/permissions";

// Why a write did not happen. The actions turn each one into the message the user sees.
export type Problem =
	| { problem: Refusal; permission: ResourcePermission }
	| { problem: "forbidden"; permission: SubjectPermission }
	| {
			problem:
				| "invalid-picture"
				| "too-many-pictures"
				| "username-taken"
				| "queue-full"
				| "account-gone"
				| "city-not-found"
				| "city-search-running"
				| "city-search-not-found"
				| "city-search-finished";
	  };

export function problem<P extends Exclude<Problem["problem"], Refusal>>(name: P) {
	return { problem: name };
}

export function isProblem(result: unknown): result is Problem {
	return typeof result === "object" && result !== null && "problem" in result;
}
