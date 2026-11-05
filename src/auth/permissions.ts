import type { Restaurant, Review, User } from "@src/db/schema";

// A signed-in User.
export type Subject = Pick<User, "id" | "role">;

// Whoever looks at a page: a signed-in User, or null for a Visitor.
export type Viewer = Subject | null;

export type TargetUser = Pick<User, "id" | "role" | "bannedAt">;

// A User as far as reading their Reviews goes, which depends on whether the viewer follows them.
export type ReviewAuthor = Pick<User, "id" | "isPrivate"> & { isFollowedByViewer: boolean };

export type TargetReview = Pick<Review, "authorId"> & { isListed: boolean; author: ReviewAuthor };

export type TargetRestaurant = Pick<Restaurant, "status" | "suggestedBy">;

interface Permissions {
	"user:view-profile": TargetUser;
	"user:view-reviews": ReviewAuthor;
	"user:view-hidden-reviews": TargetUser;
	"user:view-follow-requests": TargetUser;
	"user:follow": TargetUser;
	"user:unfollow": TargetUser;
	"user:approve-follow-request": TargetUser;
	"user:remove-follower": TargetUser;
	"user:edit-settings": TargetUser;
	"user:edit-location": TargetUser;
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
	"city-search:start": undefined;
	"city-list:update": undefined;
}

export type Permission = keyof Permissions;

export type Resource<P extends Permission> = Permissions[P];

type PermissionOn<Target> = { [P in Permission]: Permissions[P] extends Target ? P : never }[Permission];

export type UserPermission = PermissionOn<TargetUser>;
export type ReviewAuthorPermission = PermissionOn<ReviewAuthor>;
export type ReviewPermission = PermissionOn<TargetReview>;
export type RestaurantPermission = PermissionOn<TargetRestaurant>;
export type ResourcePermission = UserPermission | ReviewAuthorPermission | ReviewPermission | RestaurantPermission;
// The permissions on no resource, which depend only on the user.
export type SubjectPermission = Exclude<Permission, ResourcePermission>;

// What a Visitor may do: read what is public. Every other permission needs a signed-in User, so its policy
// never sees a Visitor.
const visitorPermissions = ["user:view-profile", "user:view-reviews", "review:view", "restaurant:view"] as const satisfies Permission[];

type VisitorPermission = (typeof visitorPermissions)[number];

function isVisitorPermission(permission: Permission): permission is VisitorPermission {
	return (visitorPermissions as readonly Permission[]).includes(permission);
}

type ResourceArgs<P extends Permission> = Permissions[P] extends undefined ? [] : [resource: Permissions[P]];

type Policy<P extends Permission> = (subject: P extends VisitorPermission ? Viewer : Subject, ...resource: ResourceArgs<P>) => boolean;

function isAdmin(user: Pick<User, "role"> | null) {
	return user?.role === "admin";
}

function isSelf(viewer: Viewer, user: Pick<User, "id">) {
	return viewer?.id === user.id;
}

// The author shares their Reviews with the viewer. visibility.ts writes the same rule as SQL, for the lists.
function sharesReviewsWith(viewer: Viewer, author: ReviewAuthor) {
	return !author.isPrivate || author.isFollowedByViewer || isSelf(viewer, author);
}

// CONTEXT.md explains each rule. The rules on roles keep at least one Admin, and never a banned one.
const policies: { [P in Permission]: Policy<P> } = {
	"user:view-profile": (viewer, user) => isAdmin(viewer) || !user.bannedAt,
	// Admins read the Reviews of a private Profile to decide whether to ban its User.
	"user:view-reviews": (viewer, author) => sharesReviewsWith(viewer, author) || isAdmin(viewer),
	"user:view-hidden-reviews": (subject, user) => isSelf(subject, user),
	"user:view-follow-requests": (subject, user) => isSelf(subject, user),
	"user:follow": (subject, user) => !isSelf(subject, user) && !user.bannedAt,
	"user:unfollow": (subject, user) => !isSelf(subject, user),
	// The user is the one who asked to follow the subject.
	"user:approve-follow-request": (subject, user) => !isSelf(subject, user) && !user.bannedAt,
	"user:remove-follower": (subject, user) => !isSelf(subject, user),
	"user:edit-settings": (subject, user) => isSelf(subject, user) || isAdmin(subject),
	// Only the User sees their coordinates, so an Admin who manages their account does not.
	"user:edit-location": (subject, user) => isSelf(subject, user),
	"user:manage-sessions": (subject, user) => isSelf(subject, user) || isAdmin(subject),
	"user:export-data": (subject, user) => isSelf(subject, user),
	"user:delete-account": (subject, user) => isSelf(subject, user) && !isAdmin(user),
	"user:ban": (subject, user) => isAdmin(subject) && !isAdmin(user),
	"user:change-role": (subject, user) => isAdmin(subject) && !isSelf(subject, user) && !user.bannedAt,
	"review:view": (viewer, review) =>
		(review.isListed && sharesReviewsWith(viewer, review.author)) || viewer?.id === review.authorId || isAdmin(viewer),
	"review:edit": (subject, review) => subject.id === review.authorId,
	"review:delete": (subject, review) => subject.id === review.authorId || isAdmin(subject),
	// An Admin who may see a Review only to moderate it may not like it.
	"review:like": (subject, review) => review.isListed && sharesReviewsWith(subject, review.author) && subject.id !== review.authorId,
	"review:unlike": (subject, review) => subject.id !== review.authorId,
	"restaurant:view": (viewer, restaurant) => restaurant.status === "approved" || (viewer !== null && restaurant.suggestedBy === viewer.id) || isAdmin(viewer),
	"restaurant:review": (_subject, restaurant) => restaurant.status === "approved",
	"restaurant:collect": (_subject, restaurant) => restaurant.status === "approved",
	"restaurant:moderate": (subject) => isAdmin(subject),
	"restaurant:suggest": () => true,
	"admin-console:view": (subject) => isAdmin(subject),
	"city-search:start": (subject) => isAdmin(subject),
	"city-list:update": (subject) => isAdmin(subject),
};

function decide(viewer: Viewer, permission: Permission, resource: unknown[]): boolean {
	if (viewer === null && !isVisitorPermission(permission)) return false;
	return (policies[permission] as (viewer: Viewer, ...resource: unknown[]) => boolean)(viewer, ...resource);
}

export function can<P extends Permission>(viewer: Viewer, permission: P, ...resource: ResourceArgs<P>): boolean {
	return decide(viewer, permission, resource);
}

export function canOn<P extends ResourcePermission>(viewer: Viewer, permission: P, resource: Resource<P>): boolean {
	return decide(viewer, permission, [resource]);
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

// Why the viewer may not have the permission on the resource, or undefined when they may.
export function refusal<P extends ResourcePermission>(viewer: Viewer, permission: P, resource: Resource<P> | undefined): Refusal | undefined {
	if (!resource) return "not-found";
	const view = viewPermissions[resourceOf(permission)];
	if (view && !canOn(viewer, view, resource as never)) return "not-found";
	return canOn(viewer, permission, resource) ? undefined : "forbidden";
}
