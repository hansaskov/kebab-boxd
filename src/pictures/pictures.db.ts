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

export interface PictureChanges {
	insertAdded(tx: Transaction): number[];
	remove(tx: Transaction, pictures: StoredPicture[]): void;
}

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
