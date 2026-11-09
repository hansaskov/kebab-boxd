import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import type { Database } from "@src/db";
import type { RowCounts } from "@src/db/row-meter";
import type { PlannedStatement } from "@src/tests/durable-database-worker";
import { fromJson, toJson } from "@src/tests/json";
import type { LargeDatabase } from "@src/tests/large-database";

// The database in a Durable Object run by Miniflare, which counts rows the way Cloudflare bills them. SQLite in
// Node cannot count them. The Worker is bundled with esbuild, as SST bundles the Backend.

const entryPoint = fileURLToPath(new URL("durable-database-worker.ts", import.meta.url));

const { outputFiles } = await build({
	entryPoints: [entryPoint],
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

const miniflare = new Miniflare({
	workers: [
		{
			config: {
				name: "measured",
				// The date and flags SST gives the Backend Worker.
				compatibilityDate: "2025-05-05",
				compatibilityFlags: ["nodejs_compat"],
				manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: outputFiles[0]!.text } } },
				exports: { MeasuredDatabase: { type: "durable-object", storage: "sqlite" } },
				env: {
					Database: { type: "durable-object", worker: "measured", exportName: "MeasuredDatabase" },
					Pictures: { type: "r2" },
					Images: { type: "images" },
				},
			},
		},
	],
});

interface MeasuredDatabaseStub {
	fill(scale: number): Promise<string>;
	measure(area: string, method: string, args: string): Promise<string>;
	meterOverlappingWork(): Promise<string>;
}

const namespace = await miniflare.getDurableObjectNamespace("Database");

type Areas = Omit<Database, "onWork">;
type MethodOf<Area extends keyof Areas> = keyof Areas[Area] & string;
type ArgsOf<Area extends keyof Areas, Method extends MethodOf<Area>> = Areas[Area][Method] extends (...args: infer Args) => unknown ? Args : never;
type ResultOf<Area extends keyof Areas, Method extends MethodOf<Area>> = Areas[Area][Method] extends (...args: never[]) => infer Result
	? Awaited<Result>
	: never;

export interface Measured<Value> extends RowCounts {
	value: Value;
	statements: PlannedStatement[];
}

export type MeasuredDatabase = Awaited<ReturnType<typeof openLargeDatabase>>;

// A new Durable Object with a large database at the scale, whose calls tell the rows they read and wrote.
export async function openLargeDatabase(scale: number) {
	const stub = namespace.get(namespace.newUniqueId()) as unknown as MeasuredDatabaseStub;
	const subjects = fromJson(await stub.fill(scale)) as LargeDatabase;

	return {
		subjects,
		// Two pieces of work that run at once, with the rows each read and the rows of the tables they read.
		async meterOverlappingWork() {
			return fromJson(await stub.meterOverlappingWork()) as { rows: Record<"users" | "restaurants", RowCounts>; users: number; restaurants: number };
		},
		async measure<Area extends keyof Areas, Method extends MethodOf<Area>>(
			area: Area,
			method: Method,
			...args: ArgsOf<Area, Method>
		): Promise<Measured<ResultOf<Area, Method>>> {
			const measured = fromJson(await stub.measure(area, method, toJson(args))) as {
				value: ResultOf<Area, Method>;
				rows: RowCounts;
				statements: PlannedStatement[];
			};
			return { value: measured.value, statements: measured.statements, ...measured.rows };
		},
	};
}
