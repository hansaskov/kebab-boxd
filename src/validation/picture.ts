import { z } from "astro/zod";

// Every format the browser offers in a file picker that Cloudflare Images can decode, with the name people know it by.
const pictureFormats = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
	"image/avif": "AVIF",
	"image/gif": "GIF",
} as const;

export const acceptedPictureTypes = Object.keys(pictureFormats);

export const pictureFormatNames = new Intl.ListFormat("en", { type: "disjunction" }).format(Object.values(pictureFormats));

export const maxPictureMegabytes = 10;
export const maxPictureBytes = maxPictureMegabytes * 1024 * 1024;

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
