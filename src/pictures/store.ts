import { generateSecureRandomString } from "@src/auth/hash";

export const picturePathPrefix = "/pictures/";
export const pictureContentType = "image/webp";

const namePattern = /^[a-z0-9]{24}\.webp$/;

// Every format the browser offers in a file picker that Cloudflare Images can decode.
export const acceptedPictureTypes = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;

const sizes = {
	profile: { width: 512, height: 512, fit: "cover" },
	review: { width: 1600, height: 1600, fit: "scale-down" },
} as const satisfies Record<string, ImageTransform>;

export type PictureKind = keyof typeof sizes;

export class InvalidPictureError extends Error {
	constructor(readonly filename: string, options?: ErrorOptions) {
		super(`${filename} is not a picture.`, options);
		this.name = "InvalidPictureError";
	}
}

function nameOf(url: string) {
	if (!url.startsWith(picturePathPrefix)) return undefined;
	const name = url.slice(picturePathPrefix.length);
	return namePattern.test(name) ? name : undefined;
}

// The pictures are kept in an R2 bucket under their names.
export function createPictureStore(bucket: R2Bucket, images: ImagesBinding) {
	// Re-encoding drops all metadata, such as the GPS position a phone camera stores in a photo.
	// Cloudflare Images turns the picture upright first.
	async function encode(file: File, kind: PictureKind) {
		try {
			const result = await images.input(file.stream()).transform(sizes[kind]).output({ format: pictureContentType, quality: 80 });
			return await result.response().arrayBuffer();
		} catch (error) {
			throw new InvalidPictureError(file.name, { cause: error });
		}
	}

	async function save(file: File, kind: PictureKind): Promise<string> {
		const bytes = await encode(file, kind);
		const name = `${generateSecureRandomString()}.webp`;
		await bucket.put(name, bytes, { httpMetadata: { contentType: pictureContentType } });
		return `${picturePathPrefix}${name}`;
	}

	// Runs after the database no longer refers to the pictures, so a picture that cannot be removed
	// is only logged: the write it belongs to has already succeeded.
	async function remove(urls: string[]): Promise<void> {
		const names = urls.flatMap((url) => nameOf(url) ?? []);
		if (names.length === 0) return;
		try {
			await bucket.delete(names);
		} catch (error) {
			console.error("Could not remove pictures", urls, error);
		}
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

	async function read(name: string): Promise<Uint8Array | undefined> {
		if (!namePattern.test(name)) return undefined;
		const object = await bucket.get(name);
		return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
	}

	return { save, saveAll, read, remove };
}

export type PictureStore = ReturnType<typeof createPictureStore>;
