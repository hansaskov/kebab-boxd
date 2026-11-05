import type { Refusal } from "@src/auth/permissions";
import type { SettingsSection } from "@src/data/settings-sections";
import type { Notification } from "@src/db/notifications";
import type { SearchType } from "@src/validation/search-params";

function userPath(username: string) {
	return `/${encodeURIComponent(username)}`;
}

export function profileHref(username: string) {
	return `${userPath(username)}/profile`;
}

// The settings open on an overview of their sections.
export function settingsHref(username: string, section: SettingsSection | undefined = undefined) {
	const href = `${userPath(username)}/settings`;
	return section ? `${href}/${section}` : href;
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

export const adminCitiesHref = "/admin/cities";

export function adminCitySearchHref(id: number) {
	return `${adminCitiesHref}/searches/${id}`;
}

// The restaurants waiting for approval, or those one CitySearch found.
export function adminRestaurantsHref(citySearchId: number | undefined = undefined) {
	return citySearchId === undefined ? "/admin/restaurants" : `/admin/restaurants?search=${citySearchId}`;
}

// The element on OpenStreetMap, such as node/123.
export function openStreetMapHref(osmId: string) {
	return `https://www.openstreetmap.org/${osmId}`;
}

// The place on Google Maps, by its id when a User suggested it and by its name and address otherwise.
export function googleMapsHref({ name, googleMapsId, address }: { name: string; googleMapsId: string | null; address: string }) {
	const query = new URLSearchParams({ q: [name, address].filter(Boolean).join(", ") });
	if (googleMapsId) query.set("ftid", googleMapsId);
	return `https://www.google.com/maps?${query}`;
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
		// To the restaurants the search found, or, when it found none or failed, to its log.
		case "city-search-finished": {
			const { id, status, restaurantCount } = notification.citySearch;
			return status === "finished" && restaurantCount > 0 ? adminRestaurantsHref(id) : adminCitySearchHref(id);
		}
	}
}

// The page that answers a request the user may not make, as `refusal` in the permissions decides.
export const refusalPage = { "not-found": "/404", forbidden: "/403" } as const satisfies Record<Refusal, string>;

export function searchHref(type: Exclude<SearchType, "all"> | undefined = undefined) {
	return type ? `/search?type=${type}` : "/search";
}
