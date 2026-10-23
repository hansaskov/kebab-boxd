import type { User } from "@src/db/schema";

export type Subject = Pick<User, "id" | "role">;

export type TargetUser = Pick<User, "id" | "role" | "bannedAt">;

interface Permissions {
	"user:edit-settings": TargetUser;
	"user:manage-sessions": TargetUser;
	"user:export-data": TargetUser;
	"user:delete-account": TargetUser;
	"user:ban": TargetUser;
	"user:change-role": TargetUser;
	"admin-console:view": undefined;
}

export type Permission = keyof Permissions;

export type UserPermission = { [P in Permission]: Permissions[P] extends TargetUser ? P : never }[Permission];

type ResourceArgs<P extends Permission> = Permissions[P] extends undefined ? [] : [resource: Permissions[P]];

type Policy<P extends Permission> = (subject: Subject, ...resource: ResourceArgs<P>) => boolean;

function isAdmin(subject: Subject) {
	return subject.role === "admin";
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

function isAdminActingOnOther(subject: Subject, user: TargetUser) {
	return isAdmin(subject) && !isSelf(subject, user);
}

function isAdminActingOnNonAdmin(subject: Subject, user: TargetUser) {
	return isAdmin(subject) && !isAdmin(user);
}
function isAdminActingOnOtherUnbanned(subject: Subject, user: TargetUser) {
	return isAdminActingOnOther(subject, user) && !user.bannedAt;
}

const policies: { [P in Permission]: Policy<P> } = {
	"user:edit-settings": isSelfOrAdmin,
	"user:manage-sessions": isSelfOrAdmin,
	"user:export-data": isSelf,
	"user:delete-account": isSelfWithoutAdminRole,
	"user:ban": isAdminActingOnNonAdmin,
	"user:change-role": isAdminActingOnOtherUnbanned,
	"admin-console:view": isAdmin,
};

export function can<P extends Permission>(subject: Subject, permission: P, ...resource: ResourceArgs<P>): boolean {
	return policies[permission](subject, ...resource);
}
