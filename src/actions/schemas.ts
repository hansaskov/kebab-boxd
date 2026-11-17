import { z } from "astro/zod";
import { maxPictureBytes, maxPictureMegabytes } from "@src/pictures/store";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, reservedUsernames } from "@src/users/username";

// The schemas that the forms of several features share. The schemas of one feature live in its actions.ts.

export const idSchema = z.number().int().positive();

const usernamePatternMessage = "Use only letters A–Z or a–z, digits and underscores.";

export const usernameSchema = z
	.string()
	.min(USERNAME_MIN_LENGTH)
	.max(USERNAME_MAX_LENGTH)
	.regex(/^[A-Za-z0-9_]+$/, usernamePatternMessage)
	.toLowerCase()
	.refine((username) => !reservedUsernames.has(username), "This username is reserved.");

const pictureSchema = z.instanceof(File).refine((file) => file.size <= maxPictureBytes, `A picture can be at most ${maxPictureMegabytes} MB.`);

// A file input that the user left empty still sends an entry: a file without bytes, or on Cloudflare an empty string.
const fileEntrySchema = z
	.union([z.instanceof(File), z.literal("")])
	.transform((entry) => (entry instanceof File && entry.size > 0 ? entry : undefined));

export const requiredPictureSchema = fileEntrySchema.pipe(z.instanceof(File, { error: "Choose a picture." })).pipe(pictureSchema);

export function picturesSchema(max: number) {
	return z
		.array(fileEntrySchema)
		.transform((entries) => entries.filter((entry) => entry !== undefined))
		.pipe(z.array(pictureSchema).max(max, `Add at most ${max} pictures.`));
}
