import type { Database } from "@src/db";

export interface DatabaseCall {
	area: string;
	method: string;
	args: unknown[];
}

export interface DatabaseReply {
	values: unknown[];
	wokeUp: boolean;
}

export interface DatabaseRpc {
	call(calls: DatabaseCall[]): Promise<DatabaseReply>;
}

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

export class Query<Result> {
	declare readonly result: Result;
	constructor(readonly call: DatabaseCall) {}
}

type QueryMethods<Area> = {
	[Method in keyof Area]: Area[Method] extends (...args: infer Args) => infer Result ? (...args: Args) => Query<Awaited<Result>> : never;
};

type QueryAreas = {
	[Area in keyof Database as Database[Area] extends (...args: never[]) => unknown ? never : Area]: QueryMethods<Database[Area]>;
};

export type Queries = Record<string, Query<unknown> | undefined>;

type ResultOf<Q> = Q extends Query<infer Result> ? Result : undefined;

export type Loaded<Q extends Queries> = { [Name in keyof Q]: ResultOf<Q[Name]> };

export type RemoteDatabase = QueryAreas & {
	load<Q extends Query<unknown>>(query: Q): Promise<ResultOf<Q>>;
	load<Q extends Queries>(queries: Q): Promise<Loaded<Q>>;
};

function queryArea(area: string) {
	return new Proxy(
		{},
		{
			get: (_, method) => (typeof method !== "string" || method === "then" ? undefined : (...args: unknown[]) => new Query({ area, method, args })),
		},
	);
}

function queryAreas(): QueryAreas {
	const areas = new Map<string, unknown>();
	return new Proxy({} as QueryAreas, {
		get: (_, area) => {
			if (typeof area !== "string" || area === "then") return undefined;
			if (!areas.has(area)) areas.set(area, queryArea(area));
			return areas.get(area);
		},
	});
}

export function connectDatabase(rpc: DatabaseRpc): RemoteDatabase {
	const areas = queryAreas();

	async function load(queries: Query<unknown> | Queries): Promise<unknown> {
		if (queries instanceof Query) return (await load({ value: queries }) as { value: unknown }).value;

		const sent = Object.entries(queries).filter((entry): entry is [string, Query<unknown>] => entry[1] !== undefined);
		const calls = await Promise.all(sent.map(async ([, query]) => ({ ...query.call, args: (await pack(query.call.args)) as unknown[] })));
		const { values } = calls.length > 0 ? await rpc.call(calls) : { values: [] };
		const loaded: Record<string, unknown> = Object.fromEntries(Object.keys(queries).map((name) => [name, undefined]));
		sent.forEach(([name], index) => (loaded[name] = values[index]));
		return loaded;
	}

	return new Proxy(areas, {
		get: (target, name, receiver) => (name === "load" ? load : Reflect.get(target, name, receiver)),
	}) as RemoteDatabase;
}

export function loadingOnce(db: RemoteDatabase): RemoteDatabase {
	let hasLoaded = false;
	async function load(queries: Query<unknown> | Queries): Promise<unknown> {
		if (hasLoaded) throw new Error("A page loads from the database once. Put every query of the page in the same load.");
		hasLoaded = true;
		return db.load(queries as Queries);
	}
	return new Proxy(db, {
		get: (target, name, receiver) => (name === "load" ? load : Reflect.get(target, name, receiver)),
	});
}

export function localDatabase(db: Database): RemoteDatabase {
	return connectDatabase({ call: async (calls) => ({ values: await callDatabaseAll(db, calls), wokeUp: false }) });
}

export function callDatabase(db: Database, area: string, method: string, args: unknown[]): Promise<unknown> {
	const target: unknown = Object.hasOwn(db, area) ? db[area as keyof Database] : undefined;
	const fn: unknown = isPlainObject(target) && Object.hasOwn(target, method) ? target[method] : undefined;
	if (typeof fn !== "function") throw new Error(`The database has no method ${area}.${method}.`);
	return Promise.resolve(fn(...(unpack(args) as unknown[])));
}

export function callDatabaseAll(db: Database, calls: DatabaseCall[]): Promise<unknown[]> {
	return Promise.all(calls.map(({ area, method, args }) => callDatabase(db, area, method, args)));
}
