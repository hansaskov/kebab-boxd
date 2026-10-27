import type { Refusal } from "@src/auth/permissions";
import type { Notification } from "@src/db/queries/notifications";

function userPath(username: string) {
	return `/${encodeURIComponent(username)}`;
}

export function profileHref(username: string) {
	return `${userPath(username)}/profile`;
}

export function settingsHref(username: string) {
	return `${userPath(username)}/settings`;
}

export function sessionHistoryHref(username: string, sessionId: string) {
	return `${settingsHref(username)}/sessions/${encodeURIComponent(sessionId)}`;
}

export function personalDataExportHref(username: string) {
	return `/api/users/${encodeURIComponent(username)}/export`;
}

export function adminUserHref(username: string) {
	return `/admin/users/${encodeURIComponent(username)}`;
}

export function restaurantHref(id: number) {
	return `/restaurants/${id}`;
}

export function newReviewHref(restaurantId: number) {
	return `/reviews/new?restaurant=${restaurantId}`;
}

export function reviewHref(id: number) {
	return `/reviews/${id}`;
}

export function editReviewHref(id: number) {
	return `${reviewHref(id)}/edit`;
}

export function exploreHref({ center, zoom }: { center: { latitude: number; longitude: number }; zoom: number }) {
	const query = new URLSearchParams({
		lat: center.latitude.toFixed(5),
		lng: center.longitude.toFixed(5),
		zoom: String(zoom),
	});
	return `/explore?${query}`;
}

export function notificationHref(notification: Notification) {
	switch (notification.kind) {
		case "follow":
			return profileHref(notification.actor.username);
		case "like":
			return reviewHref(notification.review.id);
		case "suggestion-approved":
		case "suggestion-rejected":
			return restaurantHref(notification.restaurant.id);
	}
}

// The page that answers a request the user may not make, as `refusal` in the permissions decides.
export const refusalPage = { "not-found": "/404", forbidden: "/403" } as const satisfies Record<Refusal, string>;
