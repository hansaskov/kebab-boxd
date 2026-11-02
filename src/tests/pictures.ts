import { readdirSync } from "node:fs";
import sharp from "sharp";

interface PictureOptions {
	width?: number;
	height?: number;
	orientation?: number;
	description?: string;
}

export async function pictureFile(name = "kebab.jpg", { width = 40, height = 20, orientation, description }: PictureOptions = {}) {
	let image = sharp({ create: { width, height, channels: 3, background: "#c84" } }).jpeg();
	if (orientation) image = image.withMetadata({ orientation });
	if (description) image = image.withExifMerge({ IFD0: { ImageDescription: description } });
	return new File([new Uint8Array(await image.toBuffer())], name, { type: "image/jpeg" });
}

export function textFile(name = "menu.jpg") {
	return new File(["This is not a picture."], name, { type: "image/jpeg" });
}

export function storedPictureNames(directory: string) {
	return readdirSync(directory).toSorted();
}

export function nameOf(url: string) {
	return url.split("/").at(-1)!;
}
