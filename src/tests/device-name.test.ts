import { describe, expect, it } from "vitest";
import { deviceName } from "@src/format/device-name";

describe("deviceName", () => {
	it("names the session in use after this device", () => {
		expect(deviceName({ id: "first", signInOrder: 1 }, "first")).toBe("This device");
	});

	it("numbers the other sessions in the order they signed in", () => {
		expect(deviceName({ id: "first", signInOrder: 1 }, "third")).toBe("Device 1");
		expect(deviceName({ id: "second", signInOrder: 2 }, "third")).toBe("Device 2");
	});
});
