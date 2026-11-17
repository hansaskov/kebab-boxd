import type { Database } from "@src/db";

// One method of the Database to run, with its arguments.
export interface DatabaseCall {
	area: string;
	method: string;
	args: unknown[];
}

// What the Durable Object answers a load with: what each method returned, in the order of the calls, and whether
// the Durable Object woke up for them, which makes it slow. A Durable Object that has no work sleeps, and wakes for
// the next load.
export interface DatabaseReply {
	values: unknown[];
	wokeUp: boolean;
}

// What the Durable Object offers over RPC: one method that runs several methods of the Database in one trip.
export interface DatabaseRpc {
	call(calls: DatabaseCall[]): Promise<DatabaseReply>;
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

// A call of the Database that has not been sent yet. Only load sends it, and it tells what it will return.
export class Query<Result> {
	declare readonly result: Result;
	constructor(readonly call: DatabaseCall) {}
}

type QueryMethods<Area> = {
	[Method in keyof Area]: Area[Method] extends (...args: infer Args) => infer Result ? (...args: Args) => Query<Awaited<Result>> : never;
};

// The areas of the Database, each method of which makes a Query. onWork is left out: it only works inside the
// Durable Object, since a function cannot cross RPC.
type QueryAreas = {
	[Area in keyof Database as Database[Area] extends (...args: never[]) => unknown ? never : Area]: QueryMethods<Database[Area]>;
};

// The queries of one load, by the name of what each returns. A query that is not needed is left undefined.
export type Queries = Record<string, Query<unknown> | undefined>;

type ResultOf<Q> = Q extends Query<infer Result> ? Result : undefined;

export type Loaded<Q extends Queries> = { [Name in keyof Q]: ResultOf<Q[Name]> };

// The Database as the website sees it. Its methods only describe calls, and load sends them all in one trip.
export type RemoteDatabase = QueryAreas & {
	load<Q extends Query<unknown>>(query: Q): Promise<ResultOf<Q>>;
	load<Q extends Queries>(queries: Q): Promise<Loaded<Q>>;
};

function queryArea(area: string) {
	return new Proxy(
		{},
		{
			// "then" is left out, so awaiting an area does not make a Query.
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

// The Database of the Durable Object, as the website sees it. Each load is one RPC call.
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

// The Database of a page or an action, which may load once. Each load is a trip to the Durable Object of about
// 35 ms, so a page that waits for one load before it sends the next makes its user wait twice.
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

// A Database in this Worker, as the website sees it, for the tests.
export function localDatabase(db: Database): RemoteDatabase {
	return connectDatabase({ call: async (calls) => ({ values: await callDatabaseAll(db, calls), wokeUp: false }) });
}

// Runs a call that came over RPC. Only the methods of the Database itself can be called.
export function callDatabase(db: Database, area: string, method: string, args: unknown[]): Promise<unknown> {
	const target: unknown = Object.hasOwn(db, area) ? db[area as keyof Database] : undefined;
	const fn: unknown = isPlainObject(target) && Object.hasOwn(target, method) ? target[method] : undefined;
	if (typeof fn !== "function") throw new Error(`The database has no method ${area}.${method}.`);
	return Promise.resolve(fn(...(unpack(args) as unknown[])));
}

// Runs the calls of one load. They start together, as the calls of a page did when each was a trip of its own.
export function callDatabaseAll(db: Database, calls: DatabaseCall[]): Promise<unknown[]> {
	return Promise.all(calls.map(({ area, method, args }) => callDatabase(db, area, method, args)));
}
