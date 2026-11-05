import { z } from "astro/zod";
import { idSchema } from "@src/validation/id";

// The city is named as well as numbered, since the CityList finds a city by its name.
export const citySearchSchema = z.object({
	cityId: idSchema,
	cityName: z.string().trim().min(1).max(200),
});

export const citySearchTargetSchema = z.object({
	citySearchId: idSchema,
});
