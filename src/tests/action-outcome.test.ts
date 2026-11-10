import { describe, expect, it } from "vitest";
import { ActionError } from "astro:actions";
import { succeededOn, toOutcome } from "@src/actions/outcome";

const like = { toString: () => "?_action=reviews.like" };
const unlike = { toString: () => "?_action=reviews.unlike" };
const request = new Request("http://localhost/", { method: "POST", body: new FormData() });

function localsAfter(outcome: App.Locals["actionOutcome"]) {
	return { actionOutcome: outcome } as App.Locals;
}

describe("the outcome of a form action", () => {
	it("names what a successful action acted on, so the next page can point it out", async () => {
		const locals = localsAfter(await toOutcome("reviews.like", 42, undefined, request));

		expect(succeededOn(locals, like)).toBe(42);
		expect(succeededOn(locals, unlike)).toBeUndefined();
	});

	it("names nothing when the action returned no target or failed", async () => {
		expect(succeededOn(localsAfter(await toOutcome("reviews.like", undefined, undefined, request)), like)).toBeUndefined();
		expect(succeededOn(localsAfter(await toOutcome("reviews.like", { redirect: "/x" }, undefined, request)), like)).toBeUndefined();

		const failed = await toOutcome("reviews.like", 42, new ActionError({ code: "NOT_FOUND" }), request);
		expect(succeededOn(localsAfter(failed), like)).toBeUndefined();
	});
});
