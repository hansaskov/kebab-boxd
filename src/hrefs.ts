import type { Refusal } from "@src/auth/permissions";
import type { SignInReason } from "@src/data/login-reasons";
import type { SettingsSection } from "@src/data/settings-sections";
import type { Notification } from "@src/db/notifications";
import type { MapView } from "@src/map/viewport";
import { returnPathOf } from "@src/validation/return-path";
import type { SearchType } from "@src/validation/search-params";

// The page that tells Visitors what Kebab Boxd is. A User has their Feed instead, and is sent on to it.
export const landingHref = "/";

// Why the user is on the landing page, which tells them.
export const landingNotices = ["account-deleted"] as const;
export type LandingNotice = (typeof landingNotices)[number];

export function landingNoticeHref(notice: LandingNotice) {
	return `${landingHref}?${new URLSearchParams({ notice })}`;
}

export const feedHref = "/feed";

// Where the site starts: the Feed for a User, and the landing page for a Visitor.
export function homeHref(session: App.Locals["session"] | undefined) {
	return session ? feedHref : landingHref;
}

// The sign-in page, which brings the user back to the page they came from once they are signed in. A page the
// sign-in page would not bring them back to is left out of the link. Without a reason, the user came on their own.
// One who presses something on a page that needs an account is asked in a dialog on that page instead.
export function signInHref(from: URL | string | undefined = undefined, reason: SignInReason | undefined = undefined) {
	const next = returnPathOf(from);
	const query = new URLSearchParams();
	if (reason) query.set("reason", reason);
	if (next) query.set("next", next);
	return query.size > 0 ? `/login?${query}` : "/login";
}

export function googleSignInHref(returnPath: string | undefined) {
	return returnPath ? `/api/google?${new URLSearchParams({ next: returnPath })}` : "/api/google";
}

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

export function exploreHref({ center, zoom }: MapView) {
	const query = new URLSearchParams({
		lat: center.latitude.toFixed(5),
		lng: center.longitude.toFixed(5),
		zoom: String(zoom),
	});
	return `/explore?${query}`;
}

// The map of one of the cities whose name starts with the search, which the map shows among the others.
export function exploreCityHref(search: string, cityId: number) {
	return `/explore?${new URLSearchParams({ q: search, city: String(cityId) })}`;
}

export function notificationHref(notification: Notification) {
	switch (notification.kind) {
		case "follow":
		case "follow-request":
		case "follow-accepted":
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
