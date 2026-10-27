import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type ResizeOptions } from "sharp";
import { generateSecureRandomString } from "@src/auth/hash";

export const picturePathPrefix = "/pictures/";
export const pictureContentType = "image/webp";

const namePattern = /^[a-z0-9]{24}\.webp$/;

// Every format the browser offers in a file picker that sharp can decode.
export const acceptedPictureTypes = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;

const sizes = {
	profile: { width: 512, height: 512, fit: "cover" },
	review: { width: 1600, height: 1600, fit: "inside", withoutEnlargement: true },
} as const satisfies Record<string, ResizeOptions>;

export type PictureKind = keyof typeof sizes;

export class InvalidPictureError extends Error {
	constructor(readonly filename: string, options?: ErrorOptions) {
		super(`${filename} is not a picture.`, options);
		this.name = "InvalidPictureError";
	}
}

// Re-encoding drops all metadata, such as the GPS position a phone camera stores in a photo.
async function encode(file: File, kind: PictureKind) {
	try {
		return await sharp(await file.arrayBuffer(), { failOn: "error", limitInputPixels: 50_000_000 })
			.autoOrient()
			.resize(sizes[kind])
			.webp({ quality: 80 })
			.toBuffer();
	} catch (error) {
		throw new InvalidPictureError(file.name, { cause: error });
	}
}

function nameOf(url: string) {
	if (!url.startsWith(picturePathPrefix)) return undefined;
	const name = url.slice(picturePathPrefix.length);
	return namePattern.test(name) ? name : undefined;
}

function isMissingFile(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createPictureStore(directory: string) {
	const ready = mkdir(directory, { recursive: true });

	async function save(file: File, kind: PictureKind): Promise<string> {
		const bytes = await encode(file, kind);
		const name = `${generateSecureRandomString()}.webp`;
		await ready;
		await writeFile(join(directory, name), bytes, { flag: "wx" });
		return `${picturePathPrefix}${name}`;
	}

	// Runs after the database no longer refers to the pictures, so a file that cannot be removed
	// is only logged: the write it belongs to has already succeeded.
	async function remove(urls: string[]): Promise<void> {
		await Promise.all(
			urls.map(async (url) => {
				const name = nameOf(url);
				if (!name) return;
				try {
					await unlink(join(directory, name));
				} catch (error) {
					if (!isMissingFile(error)) console.error("Could not remove picture", url, error);
				}
			}),
		);
	}

	// Saves all of the files or, when one of them is not a picture, none of them.
	async function saveAll(files: File[], kind: PictureKind): Promise<string[]> {
		const saved = await Promise.allSettled(files.map((file) => save(file, kind)));
		const urls = saved.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
		const failure = saved.find((result) => result.status === "rejected");
		if (failure) {
			await remove(urls);
			throw failure.reason;
		}
		return urls;
	}

	async function read(name: string): Promise<Buffer | undefined> {
		if (!namePattern.test(name)) return undefined;
		try {
			return await readFile(join(directory, name));
		} catch (error) {
			if (isMissingFile(error)) return undefined;
			throw error;
		}
	}

	return { save, saveAll, read, remove };
}

export type PictureStore = ReturnType<typeof createPictureStore>;
