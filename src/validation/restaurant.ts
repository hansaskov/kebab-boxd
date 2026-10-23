import { z } from "astro/zod";
import { countryNames } from "@src/data/countries";
import { coordinatesTextSchema, parseCoordinates } from "@src/validation/coordinates";
import { idSchema } from "@src/validation/id";

export const suggestionSchema = z.object({
	name: z.string().trim().min(2).max(80),
	addressLine1: z.string().trim().min(3).max(100),
	postalCode: z.string().trim().max(20).nullable(),
	city: z.string().trim().min(1).max(60),
	country: z.enum(countryNames),
	coordinates: coordinatesTextSchema,
});

export const suggestRestaurantSchema = suggestionSchema.transform(({ name, coordinates, ...address }) => ({
	name,
	location: { ...address, ...parseCoordinates(coordinates)! },
}));

export const restaurantTargetSchema = z.object({
	restaurantId: idSchema,
});
