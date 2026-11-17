import { can, refusal, type Resource, type ResourcePermission, type Subject, type SubjectPermission, type UserPermission, type Viewer } from "@src/auth/permissions";
import type { Client, Transaction } from "@src/db/client";
import { chunks, durableSqliteLimits } from "@src/db/limits";
import type { Problem, Refused } from "@src/db/problem";
import { isFollowedBy, isListedReview, reviewAuthor } from "@src/db/visibility";

function findActor(tx: Transaction, id: number) {
	return tx.query.users.findFirst({ columns: { id: true, role: true, bannedAt: true }, where: { id } }).sync();
}

function refusalIn<P extends ResourcePermission>(tx: Transaction, actorId: number, permission: P, resource: Resource<P> | undefined): Problem | undefined {
	const actor = findActor(tx, actorId);
	const refused = !actor || actor.bannedAt ? "forbidden" : refusal(actor, permission, resource);
	return refused ? { problem: refused, permission } : undefined;
}

export function authorizedWrite<P extends ResourcePermission, R extends Resource<P>, T>(
	client: Client,
	actorId: number,
	permission: P,
	findResource: (tx: Transaction) => R | undefined,
	write: (tx: Transaction, resource: R) => T,
): T | Problem {
	const run = (tx: Transaction): T | Problem => {
		const resource = findResource(tx);
		return refusalIn(tx, actorId, permission, resource) ?? write(tx, resource!);
	};
	return client.transaction(run as (tx: Transaction) => Problem) as T | Problem;
}

export function refusalBeforeWrite<P extends ResourcePermission>(
	client: Client,
	actorId: number,
	permission: P,
	findResource: (tx: Transaction) => Resource<P> | undefined,
): Problem | undefined {
	return client.transaction((tx): Problem | undefined => refusalIn(tx, actorId, permission, findResource(tx)));
}

export function authorizedSubjectWrite<T>(client: Client, actorId: number, permission: SubjectPermission, write: (tx: Transaction) => T): T | Problem {
	const run = (tx: Transaction): T | Problem => {
		const actor = findActor(tx, actorId);
		return actor && !actor.bannedAt && can(actor, permission) ? write(tx) : { problem: "forbidden", permission };
	};
	return client.transaction(run as (tx: Transaction) => Problem) as T | Problem;
}

export function authorizedWriteAll<P extends ResourcePermission, R extends Resource<P>, T>(
	client: Client,
	actorId: number,
	permission: P,
	findResources: (tx: Transaction) => (R | undefined)[],
	write: (tx: Transaction, resources: R[]) => T,
): T | Problem {
	const run = (tx: Transaction): T | Problem => {
		const actor = findActor(tx, actorId);
		const resources = findResources(tx);
		for (const resource of resources) {
			const refused = !actor || actor.bannedAt ? "forbidden" : refusal(actor, permission, resource);
			if (refused) return { problem: refused, permission };
		}
		return write(tx, resources as R[]);
	};
	return client.transaction(run as (tx: Transaction) => Problem) as T | Problem;
}

function findViewer(client: Client, viewerId: number | null): Viewer | undefined {
	if (viewerId === null) return null;
	const viewer = client.query.users.findFirst({ columns: { id: true, role: true, bannedAt: true }, where: { id: viewerId } }).sync();
	return viewer && !viewer.bannedAt ? viewer : undefined;
}

export async function authorizedRead<P extends ResourcePermission, R extends Resource<P>, T>(
	client: Client,
	viewerId: number | null,
	permission: P,
	resource: R | undefined,
	read: (resource: R, viewer: Viewer) => Promise<T | Refused>,
): Promise<T | Refused> {
	const viewer = findViewer(client, viewerId);
	const refused = viewer === undefined ? "forbidden" : refusal(viewer, permission, resource);
	return refused ? { problem: refused, permission } : read(resource!, viewer!);
}

export async function authorizedSubjectRead<T>(
	client: Client,
	viewerId: number | null,
	permission: SubjectPermission,
	read: (viewer: Subject) => Promise<T>,
): Promise<T | Refused> {
	const viewer = findViewer(client, viewerId);
	return viewer && can(viewer, permission) ? read(viewer) : { problem: "forbidden", permission };
}

export const targetUserColumns = { id: true, username: true, role: true, bannedAt: true, isPrivate: true } as const;

function findTargetUser(tx: Transaction, username: string) {
	return tx.query.users.findFirst({ columns: targetUserColumns, where: { username: username.toLowerCase() } }).sync();
}

export function findUserSeenBy(client: Client, username: string, viewerId: number | null) {
	return client.query.users
		.findFirst({ columns: targetUserColumns, extras: { isFollowedByViewer: isFollowedBy(viewerId) }, where: { username: username.toLowerCase() } })
		.sync();
}

export function writeOnUser(
	client: Client,
	actorId: number,
	username: string,
	permission: UserPermission,
	write: (tx: Transaction, user: NonNullable<ReturnType<typeof findTargetUser>>) => Problem | void,
) {
	return authorizedWrite(client, actorId, permission, (tx) => findTargetUser(tx, username), (tx, user) => write(tx, user) ?? user);
}

const targetRestaurantColumns = { id: true, status: true, suggestedBy: true } as const;

export function findTargetRestaurant(tx: Transaction, id: number) {
	return tx.query.restaurants.findFirst({ columns: targetRestaurantColumns, where: { id } }).sync();
}

export function findTargetRestaurants(tx: Transaction, ids: number[]) {
	const found = new Map(
		chunks(ids, durableSqliteLimits.variableNumber)
			.flatMap((chunk) => tx.query.restaurants.findMany({ columns: targetRestaurantColumns, where: { id: { in: chunk } } }).sync())
			.map((restaurant) => [restaurant.id, restaurant]),
	);
	return ids.map((id) => found.get(id));
}

export function findTargetReview(tx: Transaction, id: number, actorId: number) {
	return tx.query.reviews
		.findFirst({
			columns: { id: true, authorId: true, restaurantId: true },
			with: { author: reviewAuthor(actorId), pictures: { columns: { id: true, url: true } } },
			extras: { isListed: (review) => isListedReview(review).mapWith(Boolean) },
			where: { id },
		})
		.sync();
}
