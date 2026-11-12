// Measures pages of the live site as a Visitor, after it has been idle and again at once.
//
//   pnpm bench:live [--rounds 3] [--idle 200] [--site https://kebab-boxd.com] [paths…]
//
// Cloudflare stops a Worker and lets a Durable Object sleep when nothing asks for them, and starts them again for the
// next request. So the first request after a while is slower than the next. Each round waits until the site has been
// idle, then asks for every path twice. Each address is new, so the cache of Visitor pages does not answer.
//
// It prints when the first byte arrived, and the Server-Timing of the answer: `db` is how long it waited for the
// database, and says when the database woke up, and `app` shows when the Web Worker had to start for the request.

import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		rounds: { type: "string", default: "3" },
		idle: { type: "string", default: "200" },
		site: { type: "string", default: "https://kebab-boxd.com" },
	},
});

// A static file, which no Worker answers, gives the time of the network alone.
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
