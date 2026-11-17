import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		rounds: { type: "string", default: "3" },
		idle: { type: "string", default: "200" },
		site: { type: "string", default: "https://kebab-boxd.com" },
	},
});

const paths = ["/robots.txt", ...(positionals.length > 0 ? positionals : ["/privacy", "/feed"])];
const idleMs = Number(options.idle) * 1000;

async function measure(path: string) {
	const url = new URL(path, options.site);
	url.searchParams.set("probe", crypto.randomUUID());
	const startedAt = performance.now();
	const response = await fetch(url, { headers: { "Accept-Encoding": "br" } });
	const firstByteMs = performance.now() - startedAt;
	await response.arrayBuffer();
	return `${path.padEnd(14)} ${firstByteMs.toFixed(0).padStart(5)} ms  ${response.headers.get("server-timing") ?? ""}`;
}

for (let round = 1; round <= Number(options.rounds); round++) {
	await new Promise((resolve) => setTimeout(resolve, idleMs));
	console.log(`Round ${round}, after ${idleMs / 1000} s idle:`);
	for (const pass of ["first", "again"]) {
		for (const path of paths) console.log(`  ${pass.padEnd(5)} ${await measure(path)}`);
	}
}
