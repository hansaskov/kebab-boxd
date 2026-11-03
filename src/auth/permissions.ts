import type { Restaurant, Review, User } from "@src/db/schema";

export type Subject = Pick<User, "id" | "role">;

export type TargetUser = Pick<User, "id" | "role" | "bannedAt">;

export type TargetReview = Pick<Review, "authorId"> & { isListed: boolean };

export type TargetRestaurant = Pick<Restaurant, "status" | "suggestedBy">;

interface Permissions {
	"user:view-profile": TargetUser;
	"user:view-hidden-reviews": TargetUser;
	"user:follow": TargetUser;
	"user:unfollow": TargetUser;
	"user:edit-settings": TargetUser;
	"user:manage-sessions": TargetUser;
	"user:export-data": TargetUser;
	"user:delete-account": TargetUser;
	"user:ban": TargetUser;
	"user:change-role": TargetUser;
	"review:view": TargetReview;
	"review:edit": TargetReview;
	"review:delete": TargetReview;
	"review:like": TargetReview;
	"review:unlike": TargetReview;
	"restaurant:view": TargetRestaurant;
	"restaurant:review": TargetRestaurant;
	"restaurant:collect": TargetRestaurant;
	"restaurant:moderate": TargetRestaurant;
	"restaurant:suggest": undefined;
	"admin-console:view": undefined;
}

export type Permission = keyof Permissions;

export type Resource<P extends Permission> = Permissions[P];

type PermissionOn<Target> = { [P in Permission]: Permissions[P] extends Target ? P : never }[Permission];

export type UserPermission = PermissionOn<TargetUser>;
export type ReviewPermission = PermissionOn<TargetReview>;
export type RestaurantPermission = PermissionOn<TargetRestaurant>;
export type ResourcePermission = UserPermission | ReviewPermission | RestaurantPermission;

type ResourceArgs<P extends Permission> = Permissions[P] extends undefined ? [] : [resource: Permissions[P]];

type Policy<P extends Permission> = (subject: Subject, ...resource: ResourceArgs<P>) => boolean;

function isAdmin(user: Pick<User, "role">) {
	return user.role === "admin";
}

function isSelf(subject: Subject, user: TargetUser) {
	return subject.id === user.id;
}

// CONTEXT.md explains each rule. The rules on roles keep at least one Admin, and never a banned one.
const policies: { [P in Permission]: Policy<P> } = {
	"user:view-profile": (subject, user) => isAdmin(subject) || !user.bannedAt,
	"user:view-hidden-reviews": (subject, user) => isSelf(subject, user),
	"user:follow": (subject, user) => !isSelf(subject, user) && !user.bannedAt,
	"user:unfollow": (subject, user) => !isSelf(subject, user),
	"user:edit-settings": (subject, user) => isSelf(subject, user) || isAdmin(subject),
	"user:manage-sessions": (subject, user) => isSelf(subject, user) || isAdmin(subject),
	"user:export-data": (subject, user) => isSelf(subject, user),
	"user:delete-account": (subject, user) => isSelf(subject, user) && !isAdmin(user),
	"user:ban": (subject, user) => isAdmin(subject) && !isAdmin(user),
	"user:change-role": (subject, user) => isAdmin(subject) && !isSelf(subject, user) && !user.bannedAt,
	"review:view": (subject, review) => review.isListed || subject.id === review.authorId || isAdmin(subject),
	"review:edit": (subject, review) => subject.id === review.authorId,
	"review:delete": (subject, review) => subject.id === review.authorId || isAdmin(subject),
	"review:like": (subject, review) => review.isListed && subject.id !== review.authorId,
	"review:unlike": (subject, review) => subject.id !== review.authorId,
	"restaurant:view": (subject, restaurant) => restaurant.status === "approved" || restaurant.suggestedBy === subject.id || isAdmin(subject),
	"restaurant:review": (_subject, restaurant) => restaurant.status === "approved",
	"restaurant:collect": (_subject, restaurant) => restaurant.status === "approved",
	"restaurant:moderate": (subject) => isAdmin(subject),
	"restaurant:suggest": () => true,
	"admin-console:view": (subject) => isAdmin(subject),
};

export function can<P extends Permission>(subject: Subject, permission: P, ...resource: ResourceArgs<P>): boolean {
	return policies[permission](subject, ...resource);
}

export function canOn<P extends ResourcePermission>(subject: Subject, permission: P, resource: Resource<P>): boolean {
	return (policies[permission] as (subject: Subject, resource: Resource<P>) => boolean)(subject, resource);
}

export type Refusal = "not-found" | "forbidden";

type NameOf<P> = P extends `${infer Name}:${string}` ? Name : never;

export type ResourceName = NameOf<ResourcePermission>;

export function resourceOf(permission: ResourcePermission): ResourceName {
	return permission.slice(0, permission.indexOf(":")) as ResourceName;
}

// A user who may not see a review or a restaurant is told that it does not exist, whatever they ask to do with it.
const viewPermissions: Partial<Record<ResourceName, ReviewPermission | RestaurantPermission>> = {
	review: "review:view",
	restaurant: "restaurant:view",
};

// Why the subject may not have the permission on the resource, or undefined when they may.
export function refusal<P extends ResourcePermission>(subject: Subject, permission: P, resource: Resource<P> | undefined): Refusal | undefined {
	if (!resource) return "not-found";
	const view = viewPermissions[resourceOf(permission)];
	if (view && !canOn(subject, view, resource as never)) return "not-found";
	return canOn(subject, permission, resource) ? undefined : "forbidden";
}
