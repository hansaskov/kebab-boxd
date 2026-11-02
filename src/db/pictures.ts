import { inArray } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import { isProblem, problem, type Problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import { InvalidPictureError, type PictureKind, type PictureStore } from "@src/pictures/store";

export interface StoredPicture {
	id: number;
	url: string;
}

// What a write returns to the caller, and the pictures it took out of the database.
export interface PictureWrite<T> {
	value: T;
	removed: StoredPicture[];
}

// Runs a write that adds the files as pictures, removes pictures, or both, and keeps the files in step with the
// rows. Encoding cannot happen inside a transaction, so the files are saved before the write and removed again
// when it fails. A file that is not a picture stops the write before it starts. The files of the removed
// pictures go once the write has succeeded; a file that cannot be removed then is only logged.
export async function writeWithPictures<T>(
	store: PictureStore,
	files: File[],
	kind: PictureKind,
	write: (urls: string[]) => PictureWrite<T> | Problem,
): Promise<T | Problem> {
	let urls: string[];
	try {
		urls = await store.saveAll(files, kind);
	} catch (error) {
		if (error instanceof InvalidPictureError) return problem("invalid-picture");
		throw error;
	}

	let result: PictureWrite<T> | Problem;
	try {
		result = write(urls);
	} catch (error) {
		await store.remove(urls);
		throw error;
	}
	if (isProblem(result)) {
		await store.remove(urls);
		return result;
	}
	await store.remove(result.removed.map((picture) => picture.url));
	return result.value;
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

export function deletePictures(tx: Transaction, pictures: StoredPicture[]) {
	if (pictures.length === 0) return;
	tx.delete(s.pictures)
		.where(inArray(s.pictures.id, pictures.map((picture) => picture.id)))
		.run();
}
