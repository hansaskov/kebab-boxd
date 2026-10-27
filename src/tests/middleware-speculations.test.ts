import { describe, expect, it } from "vitest";
import { redirectClearingSpeculations } from "@src/middleware/speculations";

describe("redirectClearingSpeculations", () => {
	it("sends the browser on and makes it drop the pages it fetched before the change", () => {
		const response = redirectClearingSpeculations("/notifications");

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/notifications");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Clear-Site-Data")).toBe("\"prefetchCache\", \"prerenderCache\"");
	});
});
