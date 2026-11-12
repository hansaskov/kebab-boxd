// Measures how long each page of the site takes to answer, as a user would wait for it.
//
//   pnpm bench:pages [--round-trip 35] [--runs 15] [--scale 4] [--only <text>] [--profile] [--skip-build]
//
// It builds the site, and runs the Web Worker and the Backend Worker with its Durable Object in workerd, as Cloudflare
// runs them. The database is the large database of the row tests. Each call of the database waits for the round
// trip to the Durable Object first: about 35 ms in production, measured as the difference between a page of a
// Visitor with one call of the database and one without.
//
// For each page and each kind of user, it tells the median and the slowest time, the calls of the database and how
// many of them the page waited for one after another. With --profile, it records where the CPU time goes, in a
// .cpuprofile of each Worker for each page, which Chrome DevTools or https://www.speedscope.app shows as a flame graph.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import type { Bench, CallRecord } from "./backend.ts";

const root = join(import.meta.dirname, "../..");

const { values: options } = parseArgs({
	options: {
		"round-trip": { type: "string", default: "35" },
		runs: { type: "string", default: "15" },
		scale: { type: "string", default: "4" },
		only: { type: "string" },
		profile: { type: "boolean", default: false },
		"skip-build": { type: "boolean", default: false },
		out: { type: "string", default: join(root, ".cache/page-latency") },
	},
});

const roundTripMs = Number(options["round-trip"]);
const runs = Number(options.runs);
const scale = Number(options.scale);
const outDir = options.out;
const siteDir = join(outDir, "site");
const profileDir = join(outDir, "profiles");
mkdirSync(outDir, { recursive: true });

// Microseconds, as the budgets of the site are written.
const excellentUs = 100_000;
const acceptableUs = 200_000;

// ---- Build ----

if (!options["skip-build"]) {
	console.log("Building the site…");
	execFileSync("pnpm", ["exec", "astro", "build", "--outDir", siteDir], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
}

const serverDir = join(siteDir, "server");
const webModules = Object.fromEntries(
	readdirSync(serverDir, { recursive: true, encoding: "utf8" })
		.filter((path) => path.endsWith(".mjs"))
		.map((path) => [path, { type: "esm" as const, contents: readFileSync(join(serverDir, path), "utf8") }]),
);

const backendBundle = await build({
	entryPoints: [join(import.meta.dirname, "backend.ts")],
	bundle: true,
	write: false,
	format: "esm",
	platform: "neutral",
	target: "es2024",
	mainFields: ["module", "main"],
	conditions: ["workerd", "worker"],
	external: ["cloudflare:*", "node:*"],
	loader: { ".sql": "text" },
	logLevel: "error",
});

// ---- Workers ----

const inspectorPort = 9239;
// The settings of the Workers in production, from sst.config.ts.
const compatibility = { compatibilityDate: "2025-05-05", compatibilityFlags: ["nodejs_compat"] };
const text = (value: string) => ({ type: "text" as const, value });
const placeholderSecrets = Object.fromEntries(
	["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "DATA_CONTROLLER_NAME", "DATA_CONTROLLER_EMAIL", "BOOTSTRAP_ADMIN_EMAIL"].map((name) => [
		name,
		text("page-latency"),
	]),
);

const miniflare = new Miniflare({
	...(options.profile ? { inspectorPort } : {}),
	// The Backend logs the rows of each call, which would bury the results. Errors still show.
	handleStructuredLogs: ({ level, message }) => {
		if (level === "error" || level === "warn") console.error(message);
	},
	workers: [
		{
			config: {
				name: "web",
				...compatibility,
				manifest: { mainModule: "entry.mjs", modulesRoot: serverDir, modules: webModules },
				env: {
					...placeholderSecrets,
					SST_RESOURCE_App: text(JSON.stringify({ name: "kebab-boxd", stage: "bench" })),
					Backend: { type: "worker", worker: "backend", exportName: "DelayedBackend" },
				},
			},
		},
		{
			config: {
				name: "backend",
				...compatibility,
				manifest: { mainModule: "backend.js", modulesRoot: import.meta.dirname, modules: { "backend.js": { type: "esm", contents: backendBundle.outputFiles[0]!.text } } },
				exports: { BenchDatabase: { type: "durable-object", storage: "sqlite" } },
				env: {
					Database: { type: "durable-object", worker: "backend", exportName: "BenchDatabase" },
					Pictures: { type: "r2" },
					Images: { type: "images" },
				},
			},
		},
	],
});

const backend = await miniflare.getWorker("backend");
const backendFetch = async (path: string) => {
	const response = await backend.fetch(`http://backend${path}`);
	if (!response.ok) throw new Error(`${path} answered ${response.status}: ${await response.text()}`);
	return response;
};

console.log(`Filling the database at scale ${scale}…`);
const { subjects, tokens } = (await (await backendFetch(`/fill?scale=${scale}`)).json()) as Bench;
await backendFetch(`/round-trip?ms=${roundTripMs}`);

// ---- Pages ----

type Role = "visitor" | keyof Bench["tokens"];

interface PageCase {
	role: Role;
	path: string;
}

const viewerSessionId = tokens.viewer.split(".")[0]!;
const { center } = subjects;
const map = `lat=${center.latitude}&lng=${center.longitude}&zoom=13`;

const cases: PageCase[] = [
	...["/", "/feed", "/explore", `/explore?${map}`, "/search", "/search?q=funen", `/restaurants/${subjects.restaurantId}`, `/reviews/${subjects.reviewId}`,
		"/author/profile", "/author/profile?tab=followers", "/privacy", "/login"].map((path) => ({ role: "visitor" as const, path })),
	...[
		"/feed",
		"/feed?feed=everyone",
		"/explore",
		"/explore?q=od",
		"/search",
		"/search?q=funen",
		"/search?q=friend&type=people",
		`/restaurants/${subjects.restaurantId}`,
		`/reviews/${subjects.reviewId}`,
		"/viewer/profile",
		"/viewer/profile?tab=favorites",
		"/viewer/profile?tab=following",
		"/author/profile",
		"/hidden/profile",
		"/notifications",
		`/reviews/new?restaurant=${subjects.restaurantId}`,
		"/restaurants/suggest",
		"/viewer/settings",
		"/viewer/settings/profile",
		"/viewer/settings/location",
		"/viewer/settings/notifications",
		"/viewer/settings/security",
		"/viewer/settings/data",
		`/viewer/settings/sessions/${viewerSessionId}`,
		"/privacy",
	].map((path) => ({ role: "viewer" as const, path })),
	...[`/reviews/${subjects.reviewId}/edit`, "/author/profile?tab=requests"].map((path) => ({ role: "author" as const, path })),
	...["/admin", "/admin/users", "/admin/users/author", "/admin/restaurants", `/admin/restaurants?search=${subjects.citySearchId}`, "/admin/cities",
		"/admin/cities?q=od", `/admin/cities/searches/${subjects.citySearchId}`].map((path) => ({ role: "admin" as const, path })),
].filter(({ role, path }) => !options.only || `${role} ${path}`.includes(options.only));

// ---- Profiler ----

// A connection to the inspector of one Worker, which records the CPU time of the requests in between.
async function openProfiler(worker: string) {
	// workerd names the inspector of each Worker after it.
	const socket = new WebSocket(`ws://127.0.0.1:${inspectorPort}/core:user:${worker}`);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 1;
	const pending = new Map<number, (result: unknown) => void>();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
		if (message.id !== undefined) pending.get(message.id)?.(message.result);
	});
	const send = (method: string, params: object = {}) =>
		new Promise<unknown>((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			socket.send(JSON.stringify({ id, method, params }));
		});
	await send("Profiler.enable");
	await send("Profiler.setSamplingInterval", { interval: 50 });
	return {
		start: () => send("Profiler.start"),
		stop: async () => ((await send("Profiler.stop")) as { profile: unknown }).profile,
		close: () => socket.close(),
	};
}

const profilers = options.profile ? { web: await openProfiler("web"), backend: await openProfiler("backend") } : undefined;
if (profilers) mkdirSync(profileDir, { recursive: true });

// ---- Measurement ----

const cookieOf = (role: Role) => (role === "visitor" ? {} : { Cookie: `__Host-session=${tokens[role]}` });

async function request({ role, path }: PageCase) {
	const startedAt = performance.now();
	const response = await miniflare.dispatchFetch(`https://kebab-boxd.com${path}`, { headers: cookieOf(role), redirect: "manual" });
	await response.arrayBuffer();
	const microseconds = Math.round((performance.now() - startedAt) * 1000);
	// The history of a request is written after its answer, so it is not part of the wait.
	const calls = ((await (await backendFetch("/calls")).json()) as CallRecord[]).filter((call) => call.call !== "history.record");
	return { status: response.status, microseconds, calls };
}

// The calls a request waited for one after another: a call that started after the last one ended waited for it.
function sequentialTrips(calls: CallRecord[]) {
	let trips = 0;
	let end = Number.NEGATIVE_INFINITY;
	for (const call of calls.toSorted((a, b) => a.startedAt - b.startedAt)) {
		if (call.startedAt >= end) trips++;
		end = Math.max(end, call.endedAt);
	}
	return trips;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const verdict = (us: number) => (us <= excellentUs ? "excellent" : us <= acceptableUs ? "good" : "UNACCEPTABLE");
const slug = ({ role, path }: PageCase) => `${role}${path.replaceAll(/[^a-z0-9]+/gi, "-")}`.replace(/-$/, "");

interface Result extends PageCase {
	status: number;
	medianUs: number;
	p90Us: number;
	calls: string[];
	trips: number;
}

const results: Result[] = [];
console.log(`Measuring ${cases.length} pages, ${runs} runs each, with a round trip of ${roundTripMs} ms to the database…\n`);

for (const page of cases) {
	// The first requests compile the code of the page.
	await request(page);
	await request(page);

	await profilers?.web.start();
	await profilers?.backend.start();
	const measured = [];
	for (let run = 0; run < runs; run++) measured.push(await request(page));
	if (profilers) {
		writeFileSync(join(profileDir, `${slug(page)}.web.cpuprofile`), JSON.stringify(await profilers.web.stop()));
		writeFileSync(join(profileDir, `${slug(page)}.backend.cpuprofile`), JSON.stringify(await profilers.backend.stop()));
	}

	const times = measured.map((run) => run.microseconds).toSorted((a, b) => a - b);
	const last = measured.at(-1)!;
	const result: Result = {
		...page,
		status: last.status,
		medianUs: percentile(times, 0.5),
		p90Us: percentile(times, 0.9),
		calls: last.calls.map((call) => call.call),
		trips: sequentialTrips(last.calls),
	};
	results.push(result);
	console.log(
		`${verdict(result.medianUs).padEnd(12)} ${String(result.medianUs).padStart(8)} µs  p90 ${String(result.p90Us).padStart(8)} µs  ` +
			`${result.trips} trips  ${result.status}  ${result.role.padEnd(7)} ${result.path}   [${result.calls.join(", ")}]`,
	);
}

profilers?.web.close();
profilers?.backend.close();
await miniflare.dispose();

writeFileSync(join(outDir, `results-${roundTripMs}ms.json`), JSON.stringify({ roundTripMs, runs, scale, results }, null, 2));
const slowest = results.toSorted((a, b) => b.medianUs - a.medianUs)[0];
const counts = Object.groupBy(results, (result) => verdict(result.medianUs));
console.log(
	`\n${counts.excellent?.length ?? 0} excellent, ${counts.good?.length ?? 0} good, ${counts.UNACCEPTABLE?.length ?? 0} unacceptable. ` +
		`Slowest: ${slowest?.role} ${slowest?.path} at ${slowest?.medianUs} µs.`,
);
if (profilers) console.log(`CPU profiles: ${profileDir}`);
