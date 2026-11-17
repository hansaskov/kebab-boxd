import { describe, expect, it } from "vitest";
import { isGoogleMapsLink, parsePlaceLink } from "@src/restaurants/google-maps";

// Where https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA redirected to on 27 October 2026.
const placeLink =
	"https://www.google.com/maps/place/Shawarma+Village/@55.3956228,10.3794954,16z/data=!3m1!5s0x464cdff9f3240e57:0x322d27eae096a498!4m6!3m5!1s0x464cdf40a60240ff:0x42ef3a5ea295d42e!8m2!3d55.3956231!4d10.3827639!16s%2Fg%2F11q1q89_m2?entry=tts&g_ep=EgoyMDI2MTAyMC4wIPu8ASoASAFQAw%3D%3D&skid=ec096105-c5cf-4800-9bb6-3dc667250194";


describe("a Google Maps link", () => {
	it("is refused when it is not https at Google, or does not point to one place", () => {
		expect(isGoogleMapsLink("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA")).toBe(true);
		for (const link of [placeLink.replace("https:", "http:"), "https://goo.gl/AbCdEf", "https://maps.app.goo.gl.example.com/XEqFEXq6aNBqJRFJA"]) {
			expect(isGoogleMapsLink(link), link).toBe(false);
		}
		for (const link of [
			"https://www.google.com/maps/@55.3956228,10.3794954,16z",
			"https://www.google.com/maps/search/kebab/@55.39,10.38,15z",
			"https://www.google.com.evil.example/maps/place/Shawarma+Village/data=!1s0x1:0x2!3d55.4!4d10.4",
			placeLink.replace("!3d55.3956231", "!3d95.3956231"),
			placeLink.replace("Shawarma+Village", "Kebab%E0%A4"),
		]) {
			expect(parsePlaceLink(link), link).toBeUndefined();
		}
	});
});
