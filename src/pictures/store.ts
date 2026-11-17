import { generateSecureRandomString } from "@src/auth/hash";

export const picturePathPrefix = "/pictures/";
export const pictureContentType = "image/webp";

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

const namePattern = /^[a-z0-9]{24}\.webp$/;

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

export function createPictureStore(bucket: R2Bucket, images: ImagesBinding) {
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

	async function remove(urls: string[]): Promise<void> {
		const names = urls.flatMap((url) => nameOf(url) ?? []);
		if (names.length === 0) return;
		try {
			await bucket.delete(names);
		} catch (error) {
			console.error("Could not remove pictures", urls, error);
		}
	}

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
