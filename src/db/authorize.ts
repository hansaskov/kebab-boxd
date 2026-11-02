import { refusal, type Resource, type ResourcePermission, type UserPermission } from "@src/auth/permissions";
import type { Client, Transaction } from "@src/db/client";
import type { Problem } from "@src/db/problem";
import { isListedReview } from "@src/db/visibility";

function findActor(tx: Transaction, id: number) {
	return tx.query.users.findFirst({ columns: { id: true, role: true, bannedAt: true }, where: { id } }).sync();
}

// The only check of a permission on a resource: it reads the actor and the resource inside the write
// transaction, so a role or a resource that changes while the request runs cannot slip through.
export function authorizedWrite<P extends ResourcePermission, R extends Resource<P>, T>(
	client: Client,
	actorId: number,
	permission: P,
	findResource: (tx: Transaction) => R | undefined,
	write: (tx: Transaction, resource: R) => T,
): T | Problem {
	const run = (tx: Transaction): T | Problem => {
		const actor = findActor(tx, actorId);
		const resource = findResource(tx);
		const refused = !actor || actor.bannedAt ? "forbidden" : refusal(actor, permission, resource);
		return refused ? { problem: refused, permission } : write(tx, resource!);
	};
	// The transaction type refuses a generic result because it cannot prove that the result is no promise.
	// The writes are synchronous, so it is not.
	return client.transaction(run as (tx: Transaction) => Problem) as T | Problem;
}

// The user a write is about, as the permissions need them and the action needs them to name the page it goes back to.
export const targetUserColumns = { id: true, username: true, role: true, bannedAt: true } as const;

function findTargetUser(tx: Transaction, username: string) {
	return tx.query.users.findFirst({ columns: targetUserColumns, where: { username: username.toLowerCase() } }).sync();
}

// A write on the user named `username`, found inside the transaction. Returns the user it wrote to.
export function writeOnUser(
	client: Client,
	actorId: number,
	username: string,
	permission: UserPermission,
	write: (tx: Transaction, user: NonNullable<ReturnType<typeof findTargetUser>>) => Problem | void,
) {
	return authorizedWrite(client, actorId, permission, (tx) => findTargetUser(tx, username), (tx, user) => write(tx, user) ?? user);
}

export function findTargetRestaurant(tx: Transaction, id: number) {
	return tx.query.restaurants.findFirst({ columns: { status: true, suggestedBy: true }, where: { id } }).sync();
}

// With its pictures, whose files go when the write removes them.
export function findTargetReview(tx: Transaction, id: number) {
	return tx.query.reviews
		.findFirst({
			columns: { id: true, authorId: true, restaurantId: true },
			with: { pictures: { columns: { id: true, url: true } } },
			extras: { isListed: (review) => isListedReview(review).mapWith(Boolean) },
			where: { id },
		})
		.sync();
}
