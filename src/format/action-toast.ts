import type { server } from "@src/actions";
import { succeeded } from "@src/actions/outcome";
import type { Toast } from "@src/components/Toast.astro";

type ActionNames<Actions, Prefix extends string = ""> = {
	[Key in keyof Actions & string]: Actions[Key] extends (...args: never) => unknown
		? `${Prefix}${Key}`
		: ActionNames<Actions[Key], `${Prefix}${Key}.`>;
}[keyof Actions & string];

const failureTitles: Record<ActionNames<typeof server>, string> = {
	updateSettings: "Saving failed",
	updateProfilePicture: "Upload failed",
	removeProfilePicture: "Removal failed",
	updateLocation: "Saving failed",
	updateNotifications: "Saving failed",
	signOutEverywhere: "Sign-out failed",
	deleteAccount: "Deletion failed",
	"admin.approveRestaurant": "Approval failed",
	"admin.rejectRestaurant": "Rejection failed",
	"admin.banUser": "Ban failed",
	"admin.unbanUser": "Lifting the ban failed",
	"admin.changeUserRole": "Role change failed",
	"profile.follow": "Follow failed",
	"profile.unfollow": "Unfollow failed",
	"restaurants.favorite": "Saving failed",
	"restaurants.unfavorite": "Removal failed",
	"restaurants.addToBucketList": "Saving failed",
	"restaurants.removeFromBucketList": "Removal failed",
	"restaurants.suggest": "Suggestion failed",
	"reviews.create": "Publishing failed",
	"reviews.update": "Saving failed",
	"reviews.delete": "Deletion failed",
	"reviews.like": "Like failed",
	"reviews.unlike": "Unlike failed",
	"session.toggleTheme": "Theme change failed",
	"session.signOut": "Sign-out failed",
};

// Every page tells the user when the action on the request before it failed.
export function failureToast(locals: App.Locals): Toast | undefined {
	const outcome = locals.actionOutcome;
	if (!outcome?.failure) return undefined;
	const title = failureTitles[outcome.name as keyof typeof failureTitles] ?? "Something went wrong";
	return { variant: "error", title, text: outcome.failure.message };
}

export function successToast(locals: App.Locals, action: { toString(): string }, toast: Toast): Toast | undefined {
	return succeeded(locals, action) ? toast : undefined;
}
