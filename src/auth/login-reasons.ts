export const signInReasons = [
	"get-started",
	"write-review",
	"edit-review",
	"save-restaurant",
	"follow",
	"set-location",
	"suggest",
	"notifications",
	"settings",
	"download-data",
	"admin",
	"logged-out",
	"expired",
	"failed",
	"banned",
] as const;
export type SignInReason = (typeof signInReasons)[number];

export const signInReasonMessages: Record<SignInReason, { title: string; text?: string; isError?: true }> = {
	"get-started": { title: "Log in to Kebab Boxd" },
	"write-review": { title: "Log in to write a review" },
	"edit-review": { title: "Log in to edit your review" },
	"save-restaurant": { title: "Log in to save restaurants" },
	follow: { title: "Log in to follow people" },
	"set-location": { title: "Log in to set your location" },
	suggest: { title: "Log in to suggest a restaurant" },
	notifications: { title: "Log in to see your notifications" },
	settings: { title: "Log in to change your settings" },
	"download-data": { title: "Log in to download your data" },
	admin: { title: "Log in to open the admin console" },
	"logged-out": { title: "You are logged out", text: "Nothing was saved. Log in and try again.", isError: true },
	expired: { title: "Login expired", text: "Please try again.", isError: true },
	failed: { title: "Login failed", text: "Google could not confirm your account. Please try again.", isError: true },
	banned: { title: "Account banned", text: "An admin has banned this account, so you cannot log in.", isError: true },
};

export function loginDialogId(reason: SignInReason) {
	return `login-${reason}`;
}
