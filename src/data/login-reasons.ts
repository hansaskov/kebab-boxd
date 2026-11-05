// Why someone must log in, which they are told. A Visitor who presses something that needs an account sees it in a
// dialog on the same page. One who opens a page that needs an account, sends a form after they were logged out, or
// whose attempt to sign in did not succeed, is sent to the login page, which tells them in a toast.
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

// The dialog on a page that asks a Visitor to log in for the reason. The button that opens it names it.
export function loginDialogId(reason: SignInReason) {
	return `login-${reason}`;
}
