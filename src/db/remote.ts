import type { Database } from "@src/db";

// What the Backend Worker offers over RPC: one method that runs any method of the Database.
export interface DatabaseRpc {
	call(area: string, method: string, args: unknown[]): Promise<unknown>;
}

// A File cannot cross RPC, so its bytes travel instead and the other side makes a new File of them.
interface PackedFile {
	packedFile: true;
	name: string;
	type: string;
	bytes: ArrayBuffer;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isPackedFile(value: unknown): value is PackedFile {
	return isPlainObject(value) && value["packedFile"] === true;
}

async function pack(value: unknown): Promise<unknown> {
	if (value instanceof File) return { packedFile: true, name: value.name, type: value.type, bytes: await value.arrayBuffer() } satisfies PackedFile;
	if (Array.isArray(value)) return Promise.all(value.map(pack));
	if (isPlainObject(value)) return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await pack(item)])));
	return value;
}

function unpack(value: unknown): unknown {
	if (isPackedFile(value)) return new File([value.bytes], value.name, { type: value.type });
	if (Array.isArray(value)) return value.map(unpack);
	if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
	return value;
}

// The Database of the Durable Object, as the website sees it. Each method call is one RPC call, so only the
// asynchronous methods work: onWork is for the Durable Object itself.
export function connectDatabase(rpc: DatabaseRpc): Database {
	const areaOf = (area: string) =>
		new Proxy(
			{},
			{
				// "then" is left out, so awaiting an area does not call the Durable Object.
				get: (_, method) =>
					typeof method !== "string" || method === "then"
						? undefined
						: async (...args: unknown[]) => rpc.call(area, method, (await pack(args)) as unknown[]),
			},
		);
	const areas = new Map<string, unknown>();
	return new Proxy({} as Database, {
		get: (_, area) => {
			if (typeof area !== "string" || area === "then") return undefined;
			if (!areas.has(area)) areas.set(area, areaOf(area));
			return areas.get(area);
		},
	});
}

// Runs a call that came over RPC. Only the methods of the Database itself can be called.
export function callDatabase(db: Database, area: string, method: string, args: unknown[]): Promise<unknown> {
	const target: unknown = Object.hasOwn(db, area) ? db[area as keyof Database] : undefined;
	const fn: unknown = isPlainObject(target) && Object.hasOwn(target, method) ? target[method] : undefined;
	if (typeof fn !== "function") throw new Error(`The database has no method ${area}.${method}.`);
	return Promise.resolve(fn(...(unpack(args) as unknown[])));
}
