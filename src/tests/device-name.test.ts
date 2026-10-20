import { describe, expect, it } from "vitest";
import { deviceName } from "@src/format/device-name";

// Sorted most recently used first, which is not the order they signed in.
const sessions = [
	{ id: "second", createdAt: new Date(2000) },
	{ id: "third", createdAt: new Date(3000) },
	{ id: "first", createdAt: new Date(1000) },
];

describe("deviceName", () => {
	it("numbers the other sessions in the order they signed in", () => {
		expect(deviceName(sessions, "first", "third")).toBe("Device 1");
		expect(deviceName(sessions, "second", "third")).toBe("Device 2");
	});
});
