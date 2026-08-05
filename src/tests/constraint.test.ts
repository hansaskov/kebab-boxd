import { describe, expect, it } from "vitest";
import { z } from "astro/zod";
import { constraint } from "@src/validation/constraint";

describe("constraint", () => {
	it("derives minlength and maxlength from a string schema", () => {
		expect(constraint(z.string().min(3).max(30))).toEqual({
			minlength: 3,
			maxlength: 30,
			required: true,
		});
	});

	it("derives the pattern from a regex check", () => {
		expect(constraint(z.string().regex(/^[a-z]+$/))).toEqual({
			pattern: "^[a-z]+$",
			required: true,
		});
	});

	it("ignores patterns of other string formats", () => {
		expect(constraint(z.email())).toEqual({ required: true });
		expect(constraint(z.uuid())).toEqual({ required: true });
	});

	it("derives both bounds from a length check", () => {
		expect(constraint(z.string().length(5))).toEqual({
			minlength: 5,
			maxlength: 5,
			required: true,
		});
	});

	it("derives min and max from inclusive number bounds", () => {
		expect(constraint(z.number().gte(2).lte(10))).toEqual({
			min: 2,
			max: 10,
			required: true,
		});
	});

	it("bumps exclusive number bounds", () => {
		expect(constraint(z.number().gt(2).lt(10))).toEqual({
			min: 2 + Number.MIN_VALUE,
			max: 10 - Number.MIN_VALUE,
			required: true,
		});
	});

	it("bumps exclusive integer bounds by one", () => {
		expect(constraint(z.int().gt(2).lt(10))).toEqual({
			min: 3,
			max: 9,
			required: true,
		});
		expect(constraint(z.number().int().gte(2))).toEqual({
			min: 2,
			required: true,
		});
	});

	it("derives the step from a multipleOf check", () => {
		expect(constraint(z.number().multipleOf(0.5))).toEqual({
			step: 0.5,
			required: true,
		});
	});

	it("uses the strictest of repeated bounds", () => {
		expect(constraint(z.string().min(3).min(5).max(30).max(20))).toEqual({
			minlength: 5,
			maxlength: 20,
			required: true,
		});
	});

	it("derives date bounds as ISO strings", () => {
		const min = new Date("2020-01-01T00:00:00.000Z");
		const max = new Date("2030-01-01T00:00:00.000Z");

		expect(constraint(z.date().min(min).max(max))).toEqual({
			min: min.toISOString(),
			max: max.toISOString(),
			required: true,
		});
	});

	it("derives item counts from an array schema", () => {
		expect(constraint(z.array(z.string()).min(1).max(5))).toEqual({
			min: 1,
			max: 5,
			required: true,
		});
	});

	it("marks optional, nullable and default schemas as not required", () => {
		expect(constraint(z.string().optional())).toBeUndefined();
		expect(constraint(z.string().nullable())).toBeUndefined();
		expect(constraint(z.string().nullish())).toBeUndefined();
		expect(constraint(z.string().min(3).default("abc"))).toEqual({ minlength: 3 });
		expect(constraint(z.enum(["a", "b"]).nullable())).toBeUndefined();
	});

	it("keeps constraints added before a wrapper", () => {
		expect(constraint(z.string().max(30).nullable())).toEqual({
			maxlength: 30,
			required: undefined,
		});
	});

	it("returns undefined for schemas without constraints", () => {
		expect(constraint(z.string())).toEqual({ required: true });
		expect(constraint(z.number())).toEqual({ required: true });
		expect(constraint(z.boolean())).toEqual({ required: true });
	});
});
