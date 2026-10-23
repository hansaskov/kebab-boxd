import type { Restaurant, Review, User } from "@src/db/schema";

export type Subject = Pick<User, "id" | "role">;

export type TargetUser = Pick<User, "id" | "role" | "bannedAt">;

export type TargetReview = Pick<Review, "authorId"> & { isListed: boolean };

export type TargetRestaurant = Pick<Restaurant, "status" | "suggestedBy">;

interface Permissions {
	"user:view-profile": TargetUser;
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

function isAdmin(subject: Subject) {
	return subject.role === "admin";
}

function anyone() {
	return true;
}

function isSelf(subject: Subject, user: TargetUser) {
	return subject.id === user.id;
}

function isSelfOrAdmin(subject: Subject, user: TargetUser) {
	return isSelf(subject, user) || isAdmin(subject);
}

function isSelfWithoutAdminRole(subject: Subject, user: TargetUser) {
	return isSelf(subject, user) && !isAdmin(user);
}

function isAdminOrUnbanned(subject: Subject, user: TargetUser) {
	return isAdmin(subject) || !user.bannedAt;
}

function isOther(subject: Subject, user: TargetUser) {
	return !isSelf(subject, user);
}

function isOtherUnbanned(subject: Subject, user: TargetUser) {
	return isOther(subject, user) && !user.bannedAt;
}

function isAdminActingOnOther(subject: Subject, user: TargetUser) {
	return isAdmin(subject) && !isSelf(subject, user);
}

function isAdminActingOnNonAdmin(subject: Subject, user: TargetUser) {
	return isAdmin(subject) && !isAdmin(user);
}

function isAdminActingOnOtherUnbanned(subject: Subject, user: TargetUser) {
	return isAdminActingOnOther(subject, user) && !user.bannedAt;
}

function isAuthor(subject: Subject, review: TargetReview) {
	return subject.id === review.authorId;
}

function isAuthorOrAdmin(subject: Subject, review: TargetReview) {
	return isAuthor(subject, review) || isAdmin(subject);
}

function isListedOrByAuthorOrAdmin(subject: Subject, review: TargetReview) {
	return review.isListed || isAuthorOrAdmin(subject, review);
}

function isListedByOther(subject: Subject, review: TargetReview) {
	return review.isListed && !isAuthor(subject, review);
}

function isNotAuthor(subject: Subject, review: TargetReview) {
	return !isAuthor(subject, review);
}

function isApproved(_subject: Subject, restaurant: TargetRestaurant) {
	return restaurant.status === "approved";
}

function isApprovedOrBySuggesterOrAdmin(subject: Subject, restaurant: TargetRestaurant) {
	return isApproved(subject, restaurant) || restaurant.suggestedBy === subject.id || isAdmin(subject);
}

const policies: { [P in Permission]: Policy<P> } = {
	"user:view-profile": isAdminOrUnbanned,
	"user:follow": isOtherUnbanned,
	"user:unfollow": isOther,
	"user:edit-settings": isSelfOrAdmin,
	"user:manage-sessions": isSelfOrAdmin,
	"user:export-data": isSelf,
	"user:delete-account": isSelfWithoutAdminRole,
	"user:ban": isAdminActingOnNonAdmin,
	"user:change-role": isAdminActingOnOtherUnbanned,
	"review:view": isListedOrByAuthorOrAdmin,
	"review:edit": isAuthor,
	"review:delete": isAuthorOrAdmin,
	"review:like": isListedByOther,
	"review:unlike": isNotAuthor,
	"restaurant:view": isApprovedOrBySuggesterOrAdmin,
	"restaurant:review": isApproved,
	"restaurant:collect": isApproved,
	"restaurant:moderate": isAdmin,
	"restaurant:suggest": anyone,
	"admin-console:view": isAdmin,
};

export function can<P extends Permission>(subject: Subject, permission: P, ...resource: ResourceArgs<P>): boolean {
	return policies[permission](subject, ...resource);
}

export function canOn<P extends ResourcePermission>(subject: Subject, permission: P, resource: Resource<P>): boolean {
	return (policies[permission] as (subject: Subject, resource: Resource<P>) => boolean)(subject, resource);
}
