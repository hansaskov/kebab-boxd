import { z } from "astro/zod";
import { isGoogleMapsLink } from "@src/map/google-maps";
import { idSchema } from "@src/validation/id";

export const suggestionSchema = z.object({
	link: z
		.string()
		.trim()
		.max(2000)
		.refine(isGoogleMapsLink, "Paste the link Google Maps gives you when you share the restaurant."),
});

export const restaurantTargetSchema = z.object({
	restaurantId: idSchema,
});
