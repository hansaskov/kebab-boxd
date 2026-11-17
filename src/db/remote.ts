import type { Database } from "@src/db";
import type { SessionWithUser } from "@src/auth/sessions.db";

export interface DatabaseCall {
	area: string;
	method: string;
	args: unknown[];
}

export interface SessionToOpen {
	token: string;
	takeActionOutcome: boolean;
}

export interface DatabaseRequest {
	calls: DatabaseCall[];
	session?: SessionToOpen | undefined;
}

export interface DatabaseReply {
	values: unknown[];
	session?: SessionWithUser | null | undefined;
	wokeUp: boolean;
}

export interface DatabaseRpc {
	call(request: DatabaseRequest): Promise<DatabaseReply>;
}

interface PackedFile {
	packedFile: true;
	name: string;
	type: string;
	bytes: ArrayBuffer;
}

const viewerMark = "viewerOfTheSession";

export interface SessionViewer {
	readonly [viewerMark]: true;
}

export const sessionViewer: SessionViewer = { [viewerMark]: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isPackedFile(value: unknown): value is PackedFile {
	return isPlainObject(value) && value["packedFile"] === true;
}

function isSessionViewer(value: unknown): value is SessionViewer {
	return isPlainObject(value) && value[viewerMark] === true;
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

function withViewer(call: DatabaseCall, viewerId: number | null | undefined): DatabaseCall {
	const args = call.args.map((arg) => {
		if (!isSessionViewer(arg)) return arg;
		if (viewerId === undefined) throw new Error(`${call.area}.${call.method} asks for the viewer, but no session was opened for it.`);
		return viewerId;
	});
	return { ...call, args };
}

export class Query<Result> {
	declare readonly result: Result;
	constructor(readonly call: DatabaseCall) {}
}

type ViewerOr<Arg> = [number | null] extends [Arg] ? Arg | SessionViewer : Arg;

type QueryArgs<Args extends unknown[]> = { [Index in keyof Args]: ViewerOr<Args[Index]> };

type QueryMethods<Area> = {
	[Method in keyof Area]: Area[Method] extends (...args: infer Args) => infer Result ? (...args: QueryArgs<Args>) => Query<Awaited<Result>> : never;
};

type QueryAreas = {
	[Area in keyof Database as Database[Area] extends (...args: never[]) => unknown ? never : Area]: QueryMethods<Database[Area]>;
};

export class Choice<Result> {
	declare readonly result: Result;
	constructor(
		readonly key: string,
		readonly chosen: Entry,
	) {}
}

export type Entry = Query<unknown> | Choice<unknown> | Queries | undefined;

export type Queries = { [name: string]: Entry };

type ResultOf<E> = E extends Query<infer Result> ? Result : E extends Choice<infer Result> ? Result : E extends Queries ? Loaded<E> : undefined;

export type Loaded<Q extends Queries> = { [Name in keyof Q]: ResultOf<Q[Name]> };

type Chosen<Options extends Record<Key, Entry>, Key extends string> = { [Option in Key]: { key: Option; result: ResultOf<Options[Option]> } }[Key];

type Choose = <Key extends string, Options extends Record<Key, Entry>>(key: Key, options: Options) => Choice<Chosen<Options, Key>>;

const choose: Choose = (key, options) => new Choice(key, Object.hasOwn(options, key) ? options[key] : undefined);

type Load = {
	<Q extends Query<unknown>>(query: Q): Promise<ResultOf<Q>>;
	<Q extends Queries>(queries: Q): Promise<Loaded<Q>>;
};

export type RemoteDatabase = QueryAreas & { load: Load; choose: Choose };

export type PageDatabase = RemoteDatabase & { readonly viewer: SessionViewer };

const lookedUpByAwait = "then";

function isQueryName(name: string | symbol): name is string {
	return typeof name === "string" && name !== lookedUpByAwait;
}

function queryArea(area: string) {
	return new Proxy(
		{},
		{
			get: (_, method) => (isQueryName(method) ? (...args: unknown[]) => new Query({ area, method, args }) : undefined),
		},
	);
}

function queryAreas(): QueryAreas {
	const areas = new Map<string, unknown>();
	return new Proxy({} as QueryAreas, {
		get: (_, area) => {
			if (!isQueryName(area)) return undefined;
			if (!areas.has(area)) areas.set(area, queryArea(area));
			return areas.get(area);
		},
	});
}

function databaseWith<Extra extends object>(extra: Extra): QueryAreas & Extra {
	const areas = queryAreas();
	return new Proxy(areas, {
		get: (target, name, receiver) => (Object.hasOwn(extra, name) ? extra[name as keyof Extra] : Reflect.get(target, name, receiver)),
	}) as QueryAreas & Extra;
}

export interface Trip {
	loaded: Record<string, unknown>;
	session: SessionWithUser | null | undefined;
}

function queriesIn(entry: Entry): Query<unknown>[] {
	if (entry === undefined) return [];
	if (entry instanceof Query) return [entry];
	if (entry instanceof Choice) return queriesIn(entry.chosen);
	return Object.values(entry).flatMap(queriesIn);
}

function answerOf(entry: Entry, values: Iterator<unknown>): unknown {
	if (entry === undefined) return undefined;
	if (entry instanceof Query) return values.next().value;
	if (entry instanceof Choice) return { key: entry.key, result: answerOf(entry.chosen, values) };
	return Object.fromEntries(Object.entries(entry).map(([name, item]) => [name, answerOf(item, values)]));
}

type TripPlan = { session: SessionToOpen } | { viewerId: number | null };

export async function sendQueries(rpc: DatabaseRpc, queries: Queries, plan: TripPlan | undefined = undefined): Promise<Trip> {
	const session = plan && "session" in plan ? plan.session : undefined;
	const viewerId = plan && "viewerId" in plan ? plan.viewerId : undefined;
	const calls = await Promise.all(
		queriesIn(queries).map(async ({ call }) => {
			const bound = session ? call : withViewer(call, viewerId);
			return { ...bound, args: (await pack(bound.args)) as unknown[] };
		}),
	);
	const reply = calls.length > 0 || session ? await rpc.call({ calls, session }) : { values: [], session: undefined };
	return { loaded: answerOf(queries, reply.values.values()) as Record<string, unknown>, session: reply.session };
}

export function loadingWith(send: (queries: Queries) => Promise<Record<string, unknown>>): Load {
	return (async (queries: Query<unknown> | Queries) => {
		if (queries instanceof Query) return (await send({ value: queries }))["value"];
		return send(queries);
	}) as Load;
}

export function connectDatabase(rpc: DatabaseRpc): RemoteDatabase {
	return databaseWith({ load: loadingWith(async (queries) => (await sendQueries(rpc, queries)).loaded), choose });
}

export function pageDatabaseWith(load: Load): PageDatabase {
	return databaseWith({ load, choose, viewer: sessionViewer });
}

export function callDatabase(db: Database, { area, method, args }: DatabaseCall): Promise<unknown> {
	const target: unknown = Object.hasOwn(db, area) ? db[area as keyof Database] : undefined;
	const fn: unknown = isPlainObject(target) && Object.hasOwn(target, method) ? target[method] : undefined;
	if (typeof fn !== "function") throw new Error(`The database has no method ${area}.${method}.`);
	return Promise.resolve(fn(...(unpack(args) as unknown[])));
}

export async function answerRequest(db: Database, { calls, session: toOpen }: DatabaseRequest): Promise<Omit<DatabaseReply, "wokeUp">> {
	const session = toOpen && (await db.sessions.open(toOpen.token, { takeActionOutcome: toOpen.takeActionOutcome }));
	const viewerId = toOpen ? (session?.user.id ?? null) : undefined;
	const values = await Promise.all(calls.map((call) => callDatabase(db, withViewer(call, viewerId))));
	return { values, session };
}

export function localRpc(db: Database): DatabaseRpc {
	return { call: async (request) => ({ ...(await answerRequest(db, request)), wokeUp: false }) };
}
