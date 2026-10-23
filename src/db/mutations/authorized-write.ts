import { eq, sql } from "drizzle-orm";
import { can, type UserPermission } from "@src/auth/permissions";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

export type AuthorizedWriteResult = "updated" | "refused";

export function prepareAuthorizedWrite(client: Client) {
	const authorizationAttributes = client
		.select({ id: s.users.id, role: s.users.role, bannedAt: s.users.bannedAt })
		.from(s.users)
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	return function writeIfAuthorized(actorId: number, id: number, permission: UserPermission, write: () => void) {
		return client.transaction(
			(): AuthorizedWriteResult => {
				const actor = authorizationAttributes.get({ id: actorId });
				const target = authorizationAttributes.get({ id });
				if (!actor || !target || !can(actor, permission, target)) {
					return "refused";
				}
				write();
				return "updated";
			},
			{ behavior: "immediate" },
		);
	};
}
