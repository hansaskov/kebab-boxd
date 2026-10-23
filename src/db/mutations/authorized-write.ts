import { can, type UserPermission } from "@src/auth/permissions";
import type { Client, Transaction } from "@src/db/client";

export type AuthorizedWriteResult = "updated" | "refused";

function findAuthorizationAttributes(tx: Transaction, id: number) {
	return tx.query.users
		.findFirst({
			columns: { id: true, role: true, bannedAt: true },
			where: { id },
		})
		.sync();
}

export function writeIfAuthorized(
	client: Client,
	actorId: number,
	id: number,
	permission: UserPermission,
	write: (tx: Transaction) => void,
) {
	return client.transaction(
		(tx): AuthorizedWriteResult => {
			const actor = findAuthorizationAttributes(tx, actorId);
			const target = findAuthorizationAttributes(tx, id);
			if (!actor || !target || !can(actor, permission, target)) {
				return "refused";
			}
			write(tx);
			return "updated";
		},
		{ behavior: "immediate" },
	);
}
