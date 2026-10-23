import { inArray } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import { InvalidPictureError, type PictureKind, type PictureStore } from "@src/pictures/store";

// Saves the files before the write, since encoding them cannot happen inside a transaction, and removes
// them again unless the write keeps them. A file that is not a picture stops the write before it starts.
export async function savingPictures<T>(
	store: PictureStore,
	files: File[],
	kind: PictureKind,
	write: (urls: string[]) => T,
	keeps: (result: T) => boolean,
): Promise<T | "invalid-picture"> {
	let urls: string[];
	try {
		urls = await store.saveAll(files, kind);
	} catch (error) {
		if (error instanceof InvalidPictureError) return "invalid-picture";
		throw error;
	}

	let result: T;
	try {
		result = write(urls);
	} catch (error) {
		await store.remove(urls);
		throw error;
	}
	if (!keeps(result)) await store.remove(urls);
	return result;
}

export function insertPictures(tx: Transaction, urls: string[]) {
	if (urls.length === 0) return [];
	return tx
		.insert(s.pictures)
		.values(urls.map((url) => ({ url })))
		.returning({ id: s.pictures.id })
		.all()
		.map((picture) => picture.id);
}

export function attachReviewPictures(tx: Transaction, reviewId: number, urls: string[]) {
	const pictureIds = insertPictures(tx, urls);
	if (pictureIds.length === 0) return;
	tx.insert(s.reviewPictures)
		.values(pictureIds.map((pictureId) => ({ reviewId, pictureId })))
		.run();
}

export function deletePictures(tx: Transaction, pictureIds: number[]) {
	if (pictureIds.length === 0) return;
	tx.delete(s.pictures).where(inArray(s.pictures.id, pictureIds)).run();
}
