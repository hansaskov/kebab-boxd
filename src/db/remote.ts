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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

type ViewerId = number | null;

const viewerPlaceholderMark = "viewerOfTheSession";

export interface SessionViewer {
	readonly [viewerPlaceholderMark]: true;
}

export const sessionViewer: SessionViewer = { [viewerPlaceholderMark]: true };

function isViewerPlaceholder(value: unknown): value is SessionViewer {
	return isPlainObject(value) && value[viewerPlaceholderMark] === true;
}

function withViewerFilledIn(call: DatabaseCall, viewerId: ViewerId | undefined): DatabaseCall {
	const args = call.args.map((arg) => {
		if (!isViewerPlaceholder(arg)) return arg;
		if (viewerId === undefined) throw new Error(`${call.area}.${call.method} asks for the viewer, but no session was opened for it.`);
		return viewerId;
	});
	return { ...call, args };
}

interface FileAsBytes {
	packedFile: true;
	name: string;
	type: string;
	bytes: ArrayBuffer;
}

function isFileAsBytes(value: unknown): value is FileAsBytes {
	return isPlainObject(value) && value["packedFile"] === true;
}

async function withFilesAsBytes(value: unknown): Promise<unknown> {
	if (value instanceof File) return { packedFile: true, name: value.name, type: value.type, bytes: await value.arrayBuffer() } satisfies FileAsBytes;
	if (Array.isArray(value)) return Promise.all(value.map(withFilesAsBytes));
	if (isPlainObject(value)) return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await withFilesAsBytes(item)])));
	return value;
}

function withBytesAsFiles(value: unknown): unknown {
	if (isFileAsBytes(value)) return new File([value.bytes], value.name, { type: value.type });
	if (Array.isArray(value)) return value.map(withBytesAsFiles);
	if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withBytesAsFiles(item)]));
	return value;
}

export class Query<Result> {
	declare readonly result: Result;
	constructor(readonly call: DatabaseCall) {}
}

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

type ArgOrViewerPlaceholder<Arg> = [ViewerId] extends [Arg] ? Arg | SessionViewer : Arg;

type QueryArgs<Args extends unknown[]> = { [Index in keyof Args]: ArgOrViewerPlaceholder<Args[Index]> };

type QueryBuilders<Area> = {
	[Method in keyof Area]: Area[Method] extends (...args: infer Args) => infer Result ? (...args: QueryArgs<Args>) => Query<Awaited<Result>> : never;
};

type QueryAreas = {
	[Area in keyof Database as Database[Area] extends (...args: never[]) => unknown ? never : Area]: QueryBuilders<Database[Area]>;
};

type Chosen<Options extends Record<Key, Entry>, Key extends string> = { [Option in Key]: { key: Option; result: ResultOf<Options[Option]> } }[Key];

type Choose = <Key extends string, Options extends Record<Key, Entry>>(key: Key, options: Options) => Choice<Chosen<Options, Key>>;

const choose: Choose = (key, options) => new Choice(key, Object.hasOwn(options, key) ? options[key] : undefined);

type Load = {
	<Q extends Query<unknown>>(query: Q): Promise<ResultOf<Q>>;
	<Q extends Queries>(queries: Q): Promise<Loaded<Q>>;
};

export type RemoteDatabase = QueryAreas & { load: Load; choose: Choose };

export type PageDatabase = RemoteDatabase & { readonly viewer: SessionViewer };

const methodThatAwaitLooksFor = "then";

function isAreaOrMethodName(name: string | symbol): name is string {
	return typeof name === "string" && name !== methodThatAwaitLooksFor;
}

function queryBuildersOf(area: string) {
	return new Proxy(
		{},
		{
			get: (_, method) => (isAreaOrMethodName(method) ? (...args: unknown[]) => new Query({ area, method, args }) : undefined),
		},
	);
}

function databaseWith<Extra extends object>(extra: Extra): QueryAreas & Extra {
	const areas = new Map<string, unknown>();
	return new Proxy({} as QueryAreas & Extra, {
		get: (_, name) => {
			if (Object.hasOwn(extra, name)) return extra[name as keyof Extra];
			if (!isAreaOrMethodName(name)) return undefined;
			if (!areas.has(name)) areas.set(name, queryBuildersOf(name));
			return areas.get(name);
		},
	});
}

export interface Trip {
	loaded: Record<string, unknown>;
	session: SessionWithUser | null | undefined;
}

type TripPlan = { session: SessionToOpen } | { viewerId: ViewerId };

function queriesIn(entry: Entry): Query<unknown>[] {
	if (entry === undefined) return [];
	if (entry instanceof Query) return [entry];
	if (entry instanceof Choice) return queriesIn(entry.chosen);
	return Object.values(entry).flatMap(queriesIn);
}

function resultsShapedLike(entry: Entry, values: Iterator<unknown>): unknown {
	if (entry === undefined) return undefined;
	if (entry instanceof Query) return values.next().value;
	if (entry instanceof Choice) return { key: entry.key, result: resultsShapedLike(entry.chosen, values) };
	return Object.fromEntries(Object.entries(entry).map(([name, item]) => [name, resultsShapedLike(item, values)]));
}

function viewerFilledInBeforeSending(call: DatabaseCall, plan: TripPlan | undefined): DatabaseCall {
	const serverFillsInViewerAfterOpeningSession = plan && "session" in plan;
	if (serverFillsInViewerAfterOpeningSession) return call;
	return withViewerFilledIn(call, plan?.viewerId);
}

export async function sendQueries(rpc: DatabaseRpc, queries: Queries, plan: TripPlan | undefined = undefined): Promise<Trip> {
	const session = plan && "session" in plan ? plan.session : undefined;
	const calls = await Promise.all(
		queriesIn(queries).map(async ({ call }) => {
			const ready = viewerFilledInBeforeSending(call, plan);
			return { ...ready, args: (await withFilesAsBytes(ready.args)) as unknown[] };
		}),
	);
	const nothingToAsk = calls.length === 0 && !session;
	const reply = nothingToAsk ? { values: [], session: undefined } : await rpc.call({ calls, session });
	return { loaded: resultsShapedLike(queries, reply.values.values()) as Record<string, unknown>, session: reply.session };
}

const keyOfSingleQuery = "value";

export function loadingWith(send: (queries: Queries) => Promise<Record<string, unknown>>): Load {
	return (async (queries: Query<unknown> | Queries) => {
		if (queries instanceof Query) return (await send({ [keyOfSingleQuery]: queries }))[keyOfSingleQuery];
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
	return Promise.resolve(fn(...(withBytesAsFiles(args) as unknown[])));
}

export async function answerRequest(db: Database, { calls, session: toOpen }: DatabaseRequest): Promise<Omit<DatabaseReply, "wokeUp">> {
	const session = toOpen && (await db.sessions.open(toOpen.token, { takeActionOutcome: toOpen.takeActionOutcome }));
	const viewerId = toOpen ? (session?.user.id ?? null) : undefined;
	const values = await Promise.all(calls.map((call) => callDatabase(db, withViewerFilledIn(call, viewerId))));
	return { values, session };
}

export function localRpc(db: Database): DatabaseRpc {
	return { call: async (request) => ({ ...(await answerRequest(db, request)), wokeUp: false }) };
}
