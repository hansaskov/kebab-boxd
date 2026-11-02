import { describe, expect, it } from "vitest";
import { followRedirect, isGoogleMapsLink, parsePlaceLink, parseQueryLink } from "@src/map/google-maps";
import { toAddress } from "@src/map/nominatim";

// Where https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA redirected to on 27 October 2026.
const placeLink =
	"https://www.google.com/maps/place/Shawarma+Village/@55.3956228,10.3794954,16z/data=!3m1!5s0x464cdff9f3240e57:0x322d27eae096a498!4m6!3m5!1s0x464cdf40a60240ff:0x42ef3a5ea295d42e!8m2!3d55.3956231!4d10.3827639!16s%2Fg%2F11q1q89_m2?entry=tts&g_ep=EgoyMDI2MTAyMC4wIPu8ASoASAFQAw%3D%3D&skid=ec096105-c5cf-4800-9bb6-3dc667250194";

const place = {
	name: "Shawarma Village",
	googleMapsId: "0x464cdf40a60240ff:0x42ef3a5ea295d42e",
	latitude: 55.3956231,
	longitude: 10.3827639,
};

describe("a Google Maps link", () => {
	it("gives the name, the GoogleMapsId and the pin of the place, not the middle of the map or a nearby place", () => {
		expect(parsePlaceLink(placeLink)).toEqual(place);
		expect(parsePlaceLink(placeLink.replace("www.google.com", "www.google.dk").replace("Shawarma+Village", "K%C3%B8benhavns+D%C3%B8ner"))?.name).toBe(
			"Københavns Døner",
		);
	});

	it("with a search instead of a pin gives the name, the GoogleMapsId and the address", () => {
		const link = "https://maps.google.com/?q=Shawarma+Village,+Kongensgade+13,+5000+Odense&ftid=0x464cdf40a60240ff:0x42ef3a5ea295d42e";

		expect(parseQueryLink(link)).toEqual({ name: "Shawarma Village", googleMapsId: place.googleMapsId, address: "Kongensgade 13, 5000 Odense" });
		expect(parseQueryLink(link.replace("&ftid=0x464cdf40a60240ff:0x42ef3a5ea295d42e", ""))).toBeUndefined();
	});

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

	it("shared with a short link is followed through other short links and the consent page to the place", () => {
		const from = new URL("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA");

		expect(followRedirect("/XEqFEXq6aNBqJRFJB", from)).toEqual({ next: new URL("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJB") });
		expect(followRedirect(`https://consent.google.com/ml?continue=${encodeURIComponent(placeLink)}`, from)).toEqual({ place });
		expect(followRedirect("https://www.google.com/maps?cid=123", from)).toEqual({ place: undefined });
	});
});

describe("an OpenStreetMap address", () => {
	it("puts the street before the house number, uses the town where there is no city, and names the country in English", () => {
		// Parts of what Nominatim answered for the pin of Shawarma Village on 27 October 2026.
		expect(toAddress({ house_number: "13", road: "Kongensgade", postcode: "5000", city: "Odense", country_code: "dk" })).toEqual({
			addressLine1: "Kongensgade 13",
			postalCode: "5000",
			city: "Odense",
			country: "Denmark",
		});
		expect(toAddress({ village: "Tarup", country_code: "dk" })).toEqual({ addressLine1: null, postalCode: null, city: "Tarup", country: "Denmark" });
	});
});
