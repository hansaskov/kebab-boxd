import { Miniflare } from "miniflare";

// Real R2 and Cloudflare Images bindings, run locally by Miniflare. One instance serves every test of a thread.
const miniflare = new Miniflare({
	workers: [
		{
			config: {
				name: "tests",
				compatibilityDate: "2025-05-05",
				manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: "export default {};" } } },
				env: { Pictures: { type: "r2" }, Images: { type: "images" } },
			},
		},
	],
});

export const picturesBucket = (await miniflare.getR2Bucket("Pictures")) as unknown as R2Bucket;
export const images = (await miniflare.getImagesBinding("Images")) as unknown as ImagesBinding;

export async function storedPictureNames() {
	return (await picturesBucket.list()).objects.map((object) => object.key).toSorted();
}

export async function removeAllPictures() {
	const names = await storedPictureNames();
	if (names.length > 0) await picturesBucket.delete(names);
}
