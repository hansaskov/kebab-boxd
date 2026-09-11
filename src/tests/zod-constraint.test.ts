import { describe, expect, it } from "vitest";
import { z } from "astro/zod";
import { getConstraintsFromZodSchmea } from "@src/validation/constraint";

describe("constraint", () => {
	it("derives minlength and maxlength from a string schema", () => {
		expect(getConstraintsFromZodSchmea(z.string().min(3).max(30))).toEqual({
			minlength: 3,
			maxlength: 30,
			required: true,
		});
	});

	it("derives the pattern from a regex check", () => {
		expect(getConstraintsFromZodSchmea(z.string().regex(/^[a-z]+$/))).toEqual({
			pattern: "^[a-z]+$",
			required: true,
		});
	});

	it("ignores patterns of other string formats", () => {
		expect(getConstraintsFromZodSchmea(z.email())).toEqual({ required: true });
		expect(getConstraintsFromZodSchmea(z.uuid())).toEqual({ required: true });
	});

	it("derives both bounds from a length check", () => {
		expect(getConstraintsFromZodSchmea(z.string().length(5))).toEqual({
			minlength: 5,
			maxlength: 5,
			required: true,
		});
	});

	it("derives min and max from inclusive number bounds", () => {
		expect(getConstraintsFromZodSchmea(z.number().gte(2).lte(10))).toEqual({
			min: 2,
			max: 10,
			required: true,
		});
	});

	it("bumps exclusive number bounds", () => {
		expect(getConstraintsFromZodSchmea(z.number().gt(2).lt(10))).toEqual({
			min: 2 + Number.MIN_VALUE,
			max: 10 - Number.MIN_VALUE,
			required: true,
		});
	});

	it("bumps exclusive integer bounds by one", () => {
		expect(getConstraintsFromZodSchmea(z.int().gt(2).lt(10))).toEqual({
			min: 3,
			max: 9,
			required: true,
		});
		expect(getConstraintsFromZodSchmea(z.number().int().gte(2))).toEqual({
			min: 2,
			required: true,
		});
	});

	it("derives the step from a multipleOf check", () => {
		expect(getConstraintsFromZodSchmea(z.number().multipleOf(0.5))).toEqual({
			step: 0.5,
			required: true,
		});
	});

	it("uses the strictest of repeated bounds", () => {
		expect(getConstraintsFromZodSchmea(z.string().min(3).min(5).max(30).max(20))).toEqual({
			minlength: 5,
			maxlength: 20,
			required: true,
		});
	});

	it("derives date bounds as ISO strings", () => {
		const min = new Date("2020-01-01T00:00:00.000Z");
		const max = new Date("2030-01-01T00:00:00.000Z");

		expect(getConstraintsFromZodSchmea(z.date().min(min).max(max))).toEqual({
			min: min.toISOString(),
			max: max.toISOString(),
			required: true,
		});
	});

	it("derives item counts from an array schema", () => {
		expect(getConstraintsFromZodSchmea(z.array(z.string()).min(1).max(5))).toEqual({
			min: 1,
			max: 5,
			required: true,
		});
	});

	it("marks optional, nullable and default schemas as not required", () => {
		expect(getConstraintsFromZodSchmea(z.string().optional())).toBeUndefined();
		expect(getConstraintsFromZodSchmea(z.string().nullable())).toBeUndefined();
		expect(getConstraintsFromZodSchmea(z.string().nullish())).toBeUndefined();
		expect(getConstraintsFromZodSchmea(z.string().min(3).default("abc"))).toEqual({ minlength: 3 });
		expect(getConstraintsFromZodSchmea(z.enum(["a", "b"]).nullable())).toBeUndefined();
	});

	it("keeps constraints added before a wrapper", () => {
		expect(getConstraintsFromZodSchmea(z.string().max(30).nullable())).toEqual({
			maxlength: 30,
			required: undefined,
		});
	});

	it("returns undefined for schemas without constraints", () => {
		expect(getConstraintsFromZodSchmea(z.string())).toEqual({ required: true });
		expect(getConstraintsFromZodSchmea(z.number())).toEqual({ required: true });
		expect(getConstraintsFromZodSchmea(z.boolean())).toEqual({ required: true });
	});
});
