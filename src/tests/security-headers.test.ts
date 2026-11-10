import { describe, expect, it } from "vitest";
import { defaultMapZoom } from "@src/data/map";
import * as s from "@src/db/schema";
import { withSecurityHeaders } from "@src/middleware/security-headers";
import { exploreHref } from "@src/hrefs";
import ExplorePage from "@src/pages/explore.astro";
import FeedPage from "@src/pages/feed.astro";
import LandingPage from "@src/pages/index.astro";
import LoginPage from "@src/pages/login.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, restaurantPlace, signIn, writeReview } from "@src/tests/database";

const site = "https://kebab.hjemmet.net";

// The sources of each directive of the Content Security Policy.
function policyOf(response: Response) {
	const header = response.headers.get("Content-Security-Policy") ?? "";
	return new Map(
		header.split("; ").map((directive) => {
			const [name = "", ...sources] = directive.split(" ");
			return [name, sources];
		}),
	);
}

describe("the security headers", () => {
	it("reach every response, also one whose headers cannot change, and leave the rest of it as it was", async () => {
		const page = withSecurityHeaders(new Response("<p>Not found</p>", { status: 404 }), false);
		const redirect = withSecurityHeaders(Response.redirect(`${site}/login`, 302), false);
		const protections = (response: Response) => [response.headers.get("X-Content-Type-Options"), policyOf(response).get("frame-ancestors")];

		expect({
			page: [page.status, await page.text(), ...protections(page)],
			redirect: [redirect.status, redirect.headers.get("Location"), ...protections(redirect)],
		}).toEqual({
			page: [404, "<p>Not found</p>", "nosniff", ["'none'"]],
			redirect: [302, `${site}/login`, "nosniff", ["'none'"]],
		});
	});

	it("allow what the pages load, and no script but the speculation rules", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Grill", { status: "approved" });
		await writeReview(db, ada.id, grill.id, 8);
		const picture = client.insert(s.pictures).values({ url: "/pictures/abcdefghijkmnpqrstuvwxyz.webp" }).returning().get();
		client.update(s.users).set({ profilePictureId: picture.id }).run();
		const locals = { db, session: await signIn(db, ada.id) };

		const pages = await Promise.all([
			renderPage(FeedPage, locals, "/feed?feed=everyone"),
			renderPage(ExplorePage, locals, exploreHref({ center: restaurantPlace, zoom: defaultMapZoom })),
			renderPage(RestaurantPage, locals, `/restaurants/${grill.id}`, { id: String(grill.id) }),
			renderPage(ProfilePage, locals, "/ada/profile", { username: "ada" }),
			renderPage(LandingPage, { db, session: null }, "/"),
			renderPage(LoginPage, { db, session: null }, "/login"),
		]);
		const html = pages.map((page) => page.html).join("\n");
		const policy = policyOf(withSecurityHeaders(new Response(), false));
		const allowsImagesFrom = (origin: string) => policy.get("img-src")?.includes(origin === site ? "'self'" : origin);

		const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
		const imageOrigins = [...new Set([...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map(([, src]) => new URL(src!, site).origin))];
		const eventHandlers = [...html.matchAll(/<[^>]+\son[a-z]+=/g)].map(([tag]) => tag);

		expect(policy.get("script-src")).toEqual(["'inline-speculation-rules'"]);
		expect(scripts.length).toBeGreaterThan(0);
		expect(scripts.filter((tag) => !tag.includes('type="speculationrules"'))).toEqual([]);
		expect(imageOrigins.toSorted()).toEqual([site, "https://tile.openstreetmap.org"]);
		expect(imageOrigins.filter((origin) => !allowsImagesFrom(origin))).toEqual([]);
		expect(eventHandlers).toEqual([]);
	});
});
