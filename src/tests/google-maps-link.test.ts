import { describe, expect, it } from "vitest";
import { followRedirect, isGoogleMapsLink, parsePlaceLink, parseQueryLink } from "@src/map/google-maps";
import { toAddress } from "@src/map/nominatim";

// Where https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA redirected to on 27 October 2026.
const placeLink =
	"https://www.google.com/maps/place/Shawarma+Village/@55.3956228,10.3794954,16z/data=!3m1!5s0x464cdff9f3240e57:0x322d27eae096a498!4m6!3m5!1s0x464cdf40a60240ff:0x42ef3a5ea295d42e!8m2!3d55.3956231!4d10.3827639!16s%2Fg%2F11q1q89_m2?entry=tts&g_ep=EgoyMDI2MTAyMC4wIPu8ASoASAFQAw%3D%3D&skid=ec096105-c5cf-4800-9bb6-3dc667250194";

describe("Google Maps links", () => {
	it("give the name, the pin of the place and its id, not the middle of the map or a nearby place", () => {
		expect(parsePlaceLink(placeLink)).toEqual({
			name: "Shawarma Village",
			googleMapsId: "0x464cdf40a60240ff:0x42ef3a5ea295d42e",
			latitude: 55.3956231,
			longitude: 10.3827639,
		});
	});

	it("decode names with letters outside English and on other Google domains", () => {
		const link = "https://www.google.dk/maps/place/K%C3%B8benhavns+D%C3%B8ner/@55.6,12.5,17z/data=!4m6!3m5!1s0x1:0x2!8m2!3d55.676!4d12.568";

		expect(parsePlaceLink(link)?.name).toBe("Københavns Døner");
	});

	it("shorten a long name at the last word that fits", () => {
		const long = "Shawarma Village Kebab, Pizza & Grillhouse – Kongensgade 13 Odense City Centre Denmark";

		expect(parsePlaceLink(placeLink.replace("Shawarma+Village", encodeURIComponent(long)))?.name).toBe(
			"Shawarma Village Kebab, Pizza & Grillhouse – Kongensgade 13 Odense City Centre",
		);
		expect(parsePlaceLink(placeLink.replace("Shawarma+Village", "K".repeat(81)))?.name).toBe("K".repeat(80));
		expect(parsePlaceLink(placeLink.replace("Shawarma+Village", "Q"))?.name).toBe("Q");
	});

	it("with a search instead of a pin give the name, the id and the address", () => {
		const link = "https://maps.google.com/?q=Shawarma+Village,+Kongensgade+13,+5000+Odense&ftid=0x464cdf40a60240ff:0x42ef3a5ea295d42e";
		const place = { name: "Shawarma Village", googleMapsId: "0x464cdf40a60240ff:0x42ef3a5ea295d42e", address: "Kongensgade 13, 5000 Odense" };

		expect(parseQueryLink(link)).toEqual(place);
		expect(parseQueryLink(link.replace("maps.google.com/", "www.google.com/maps"))).toEqual(place);
		expect(isGoogleMapsLink(link)).toBe(true);
		expect(followRedirect(link, new URL("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA"))).toEqual({ place });
		for (const refused of [
			link.replace(",+Kongensgade+13,+5000+Odense", ""),
			link.replace("&ftid=0x464cdf40a60240ff:0x42ef3a5ea295d42e", ""),
			link.replace("0x464cdf40a60240ff:", ""),
			link.replace("maps.google.com/", "www.google.com/"),
		]) {
			expect(parseQueryLink(refused), refused).toBeUndefined();
		}
	});

	it("are refused when they do not point to one place", () => {
		for (const link of [
			"https://www.google.com/maps/@55.3956228,10.3794954,16z",
			"https://www.google.com/maps/search/kebab/@55.39,10.38,15z",
			"https://www.google.com/maps/place/Odense/@55.39,10.38,12z",
			"https://www.google.com.evil.example/maps/place/Shawarma+Village/data=!1s0x1:0x2!3d55.4!4d10.4",
			placeLink.replace("!3d55.3956231", "!3d95.3956231"),
			placeLink.replace("Shawarma+Village", "+++"),
			placeLink.replace("Shawarma+Village", "Kebab%E0%A4"),
		]) {
			expect(parsePlaceLink(link), link).toBeUndefined();
		}
	});

	it("are accepted as share links or place links over https", () => {
		expect(isGoogleMapsLink("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA")).toBe(true);
		expect(isGoogleMapsLink(placeLink)).toBe(true);
		expect(isGoogleMapsLink("https://goo.gl/maps/AbCdEf")).toBe(true);
		expect(isGoogleMapsLink(placeLink.replace("www.google.com", "maps.google.com"))).toBe(true);
		expect(isGoogleMapsLink("https://maps.app.goo.gl/")).toBe(false);
		expect(isGoogleMapsLink("https://goo.gl/AbCdEf")).toBe(false);
		expect(isGoogleMapsLink(placeLink.replace("https:", "http:"))).toBe(false);
	});
});

describe("Share link redirects", () => {
	const from = new URL("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA");
	const place = parsePlaceLink(placeLink);

	it("lead to the place, also through a relative link or the consent page", () => {
		expect(followRedirect(placeLink, from)).toEqual({ place });
		expect(followRedirect(new URL(placeLink).pathname, new URL("https://www.google.com/"))).toEqual({ place });
		expect(followRedirect(`https://consent.google.com/ml?continue=${encodeURIComponent(placeLink)}`, from)).toEqual({ place });
	});

	it("are followed from one share link to the next", () => {
		expect(followRedirect("/XEqFEXq6aNBqJRFJB", from)).toEqual({ next: new URL("https://maps.app.goo.gl/XEqFEXq6aNBqJRFJB") });
	});

	it("lead nowhere when they end somewhere other than a place", () => {
		expect(followRedirect("https://www.google.com/maps?cid=123", from)).toEqual({ place: undefined });
		expect(followRedirect("https://consent.google.com/ml", from)).toEqual({ place: undefined });
	});
});

describe("OpenStreetMap addresses", () => {
	it("put the street before the house number and name the country in English", () => {
		// What Nominatim answered for the pin of Shawarma Village on 27 October 2026.
		const address = {
			house_number: "13",
			road: "Kongensgade",
			suburb: "City Campus",
			city: "Odense",
			municipality: "Odense Municipality",
			state: "Region of Southern Denmark",
			postcode: "5000",
			country: "Denmark",
			country_code: "dk",
		};

		expect(toAddress(address)).toEqual({ addressLine1: "Kongensgade 13", postalCode: "5000", city: "Odense", country: "Denmark" });
	});

	it("use the town or village where there is no city, and leave out what is missing", () => {
		expect(toAddress({ village: "Tarup", country_code: "dk" })).toEqual({ addressLine1: null, postalCode: null, city: "Tarup", country: "Denmark" });
		expect(toAddress({})).toEqual({ addressLine1: null, postalCode: null, city: null, country: null });
	});
});
