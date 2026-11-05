import { inArray } from "drizzle-orm";
import type { Resource, ResourcePermission } from "@src/auth/permissions";
import { authorizedWrite, refusalBeforeWrite } from "@src/db/authorize";
import type { Client, Transaction } from "@src/db/client";
import { problem, type Problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import { InvalidPictureError, type PictureKind, type PictureStore } from "@src/pictures/store";

export interface StoredPicture {
	id: number;
	url: string;
}

// How a write changes the picture rows. The write decides which rows change; the files follow on their own.
export interface PictureChanges {
	// Inserts a row for each file the write adds, in the order of the files, and returns their ids.
	insertAdded(tx: Transaction): number[];
	// Deletes the rows of the pictures. Their files go once the write is done.
	remove(tx: Transaction, pictures: StoredPicture[]): void;
}

// Runs a write that adds files as pictures, removes pictures, or both, and keeps the files in step with the rows.
//
// Encoding cannot happen inside a transaction, so the added files are saved before the write starts. A file that
// is not a picture stops the write before it starts. When the write throws, its transaction is undone and the added
// files go again. When it returns, the files of the removed rows go, and so do the added files it did not insert.
// A file that cannot be removed then is only logged: the rows no longer point to it.
async function writeWithPictures<T>(
	store: PictureStore,
	write: (changes: PictureChanges) => T | Problem,
	added?: { files: File[]; kind: PictureKind },
): Promise<T | Problem> {
	let addedUrls: string[];
	try {
		addedUrls = added ? await store.saveAll(added.files, added.kind) : [];
	} catch (error) {
		if (error instanceof InvalidPictureError) return problem("invalid-picture");
		throw error;
	}

	let isInserted = false;
	const removedUrls: string[] = [];
	const changes: PictureChanges = {
		insertAdded(tx) {
			isInserted = true;
			if (addedUrls.length === 0) return [];
			return tx
				.insert(s.pictures)
				.values(addedUrls.map((url) => ({ url })))
				.returning({ id: s.pictures.id })
				.all()
				.map((picture) => picture.id);
		},
		remove(tx, pictures) {
			if (pictures.length === 0) return;
			tx.delete(s.pictures)
				.where(inArray(s.pictures.id, pictures.map((picture) => picture.id)))
				.run();
			removedUrls.push(...pictures.map((picture) => picture.url));
		},
	};

	let result: T | Problem;
	try {
		result = write(changes);
	} catch (error) {
		await store.remove(addedUrls);
		throw error;
	}
	await store.remove(isInserted ? removedUrls : [...removedUrls, ...addedUrls]);
	return result;
}

// A write on a resource that adds files as pictures, removes pictures, or both, as writeWithPictures runs it.
// Encoding the files costs, so a write that would be refused is refused before they are encoded. The write
// checks the permission again in its transaction, since the actor or the resource may change meanwhile.
export async function authorizedWriteWithPictures<P extends ResourcePermission, R extends Resource<P>, T>(
	client: Client,
	store: PictureStore,
	actorId: number,
	permission: P,
	findResource: (tx: Transaction) => R | undefined,
	write: (tx: Transaction, resource: R, changes: PictureChanges) => T,
	added?: { files: File[]; kind: PictureKind },
): Promise<T | Problem> {
	if (added && added.files.length > 0) {
		const refused = refusalBeforeWrite(client, actorId, permission, findResource);
		if (refused) return refused;
	}
	return writeWithPictures(
		store,
		(changes) => authorizedWrite(client, actorId, permission, findResource, (tx, resource) => write(tx, resource, changes)),
		added,
	);
}
