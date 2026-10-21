import type { User } from "@src/db/schema";

/**
 * Attribute based access control. Every check names a Permission, and the Policy for that
 * Permission decides from the attributes of the signed-in user and of the resource. Pages and
 * actions call `can` and never look at roles themselves, so each rule lives in one place.
 */

/** The attributes of the signed-in user that policies may read. */
export type Subject = Pick<User, "id" | "role">;

/** A user that a permission is checked against. */
type TargetUser = Pick<User, "id">;

/**
 * Every Permission, written `resource:operation`, and the attributes of the resource it is
 * checked against. A Permission with no resource maps to `undefined`.
 */
interface Permissions {
	/** Open the settings page of a user and save their profile. */
	"user:edit-settings": TargetUser;
	/** List the signed-in devices of a user, read their history, and sign them out. */
	"user:manage-sessions": TargetUser;
	/** Open the admin console. */
	"admin-console:view": undefined;
}

export type Permission = keyof Permissions;

/** The permissions that are checked against a user. */
export type UserPermission = { [P in Permission]: Permissions[P] extends TargetUser ? P : never }[Permission];

/** The resource argument of a Permission: none, or the resource it is checked against. */
type ResourceArgs<P extends Permission> = Permissions[P] extends undefined ? [] : [resource: Permissions[P]];

type Policy<P extends Permission> = (subject: Subject, ...resource: ResourceArgs<P>) => boolean;

function isAdmin(subject: Subject) {
	return subject.role === "admin";
}

function isSelf(subject: Subject, user: TargetUser) {
	return subject.id === user.id;
}

// An Admin manages every User, so they pass every policy for one.
function isSelfOrAdmin(subject: Subject, user: TargetUser) {
	return isSelf(subject, user) || isAdmin(subject);
}

const policies: { [P in Permission]: Policy<P> } = {
	"user:edit-settings": isSelfOrAdmin,
	"user:manage-sessions": isSelfOrAdmin,
	"admin-console:view": isAdmin,
};

/** Whether the signed-in user has the Permission, on the resource when it has one. */
export function can<P extends Permission>(subject: Subject, permission: P, ...resource: ResourceArgs<P>): boolean {
	return policies[permission](subject, ...resource);
}
