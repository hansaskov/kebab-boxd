import { z } from "astro/zod";
import { isGoogleMapsLink } from "@src/map/google-maps";
import { pageSizes } from "@src/pagination";
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

// A page lists at most as many restaurants as its largest size, so an Admin can choose at most as many at once.
export const maxDecidedAtOnce = Math.max(...pageSizes);

export const decisionSchema = z.object({
	restaurantId: z.array(idSchema).min(1, "Choose at least one restaurant.").max(maxDecidedAtOnce),
	status: z.enum(["approved", "rejected"]),
});
