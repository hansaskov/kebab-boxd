import { canOn, type Resource, type ResourcePermission, type UserPermission } from "@src/auth/permissions";
import type { Client, Transaction } from "@src/db/client";

export type AuthorizedWriteResult = "updated" | "refused";

function findActor(tx: Transaction, id: number) {
	return tx.query.users
		.findFirst({
			columns: { id: true, role: true, bannedAt: true },
			where: { id },
		})
		.sync();
}

// Checks the permission against the actor and the resource as they are inside the write transaction,
// so a role or a resource that changed after the request was authorized cannot slip through.
export function authorizedWrite<P extends ResourcePermission, R extends Resource<P>, T>(
	client: Client,
	actorId: number,
	permission: P,
	findResource: (tx: Transaction) => R | undefined,
	write: (tx: Transaction, resource: R) => T,
): T | "refused" {
	const run = (tx: Transaction): T | "refused" => {
		const actor = findActor(tx, actorId);
		const resource = findResource(tx);
		if (!actor || actor.bannedAt || !resource || !canOn(actor, permission, resource)) {
			return "refused";
		}
		return write(tx, resource);
	};
	// The transaction type refuses a generic result because it cannot prove that the result is no promise.
	// The writes are synchronous, so it is not.
	return client.transaction(run as (tx: Transaction) => "refused", { behavior: "immediate" }) as T | "refused";
}

export function writeIfAuthorized(
	client: Client,
	actorId: number,
	id: number,
	permission: UserPermission,
	write: (tx: Transaction) => void,
): AuthorizedWriteResult {
	return authorizedWrite(client, actorId, permission, (tx) => findActor(tx, id), (tx) => {
		write(tx);
		return "updated" as const;
	});
}
