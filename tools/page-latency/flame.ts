import { readFileSync } from "node:fs";

interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
	children?: number[];
}

interface Profile {
	nodes: ProfileNode[];
	samples: number[];
	timeDeltas: number[];
}

function ownerOf(url: string) {
	const inPackage = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(url);
	if (inPackage) return inPackage[1]!;
	const inSite = /\/src\/(.+?)(?:\/[^/]+)?$/.exec(url);
	if (inSite) return `src/${inSite[1]}`;
	return url === "" ? "(runtime)" : url.replace(/.*\//, "");
}

const ms = (us: number) => `${(us / 1000).toFixed(1).padStart(8)} ms`;

for (const file of process.argv.slice(2)) {
	const profile = JSON.parse(readFileSync(file, "utf8")) as Profile;
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const self = new Map<number, number>();
	profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));

	const total = [...self.values()].reduce((sum, time) => sum + time, 0);
	const idle = [...self].filter(([id]) => byId.get(id)!.callFrame.functionName === "(idle)").reduce((sum, [, time]) => sum + time, 0);
	const busy = total - idle;

	const byFunction = new Map<string, number>();
	for (const [id, time] of self) {
		const { functionName, url, lineNumber } = byId.get(id)!.callFrame;
		const key = `${functionName || "(anonymous)"}  ${url.replace(/.*\/(chunks\/)?/, "")}:${lineNumber + 1}`;
		byFunction.set(key, (byFunction.get(key) ?? 0) + time);
	}
	const byOwner = new Map<string, number>();
	for (const [id, time] of self) {
		const owner = ownerOf(byId.get(id)!.callFrame.url);
		byOwner.set(owner, (byOwner.get(owner) ?? 0) + time);
	}

	console.log(`\n${file}\nbusy ${ms(busy)} of ${ms(total)} recorded`);
	console.log("By function, own time:");
	for (const [key, time] of [...byFunction].toSorted((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${ms(time)}  ${key}`);
	console.log("By file or package, own time:");
	for (const [key, time] of [...byOwner].toSorted((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${ms(time)}  ${key}`);
}
