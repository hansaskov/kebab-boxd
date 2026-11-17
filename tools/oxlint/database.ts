import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Node = ESTree.Node;
type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

const loopTypes = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const functionTypes = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function isFunction(node: Node): node is FunctionNode {
	return functionTypes.has(node.type);
}

function isDatabase(node: Node) {
	if (node.type === "Identifier") return node.name === "db";
	return node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier" && node.property.name === "db";
}

function isDatabaseLoad(node: ESTree.CallExpression) {
	const { callee } = node;
	return callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "load" && isDatabase(callee.object);
}

function isLocals(node: Node) {
	if (node.type === "Identifier") return node.name === "locals";
	return node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier" && node.property.name === "locals";
}

function isSessionRead(node: ESTree.CallExpression) {
	const { callee } = node;
	return callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "session" && isLocals(callee.object);
}

function enclosingFunction(node: Node): FunctionNode | undefined {
	for (let current = node.parent; current; current = current.parent) {
		if (isFunction(current)) return current;
	}
	return undefined;
}

function isInLoop(node: Node, scope: FunctionNode | undefined) {
	for (let current = node.parent; current && current !== scope; current = current.parent) {
		if (loopTypes.has(current.type)) return true;
	}
	return false;
}

function isCallback(scope: FunctionNode) {
	const { parent } = scope;
	return parent?.type === "CallExpression" && parent.arguments.includes(scope as ESTree.Expression);
}

function isAstro(filename: string) {
	return filename.endsWith(".astro");
}

function isPage(filename: string) {
	return /\/src\/pages\//.test(filename);
}

const oneLoad = defineRule({
	meta: {
		type: "problem",
		docs: { description: "A page or form waits for the database once. Put every query in the same load." },
	},
	create(context) {
		const loadsIn = new Map<FunctionNode | undefined, number>();
		const sessionReadIn = new Set<FunctionNode | undefined>();
		const astro = isAstro(context.filename);

		return {
			CallExpression(node) {
				if (isSessionRead(node)) sessionReadIn.add(enclosingFunction(node));
				if (!isDatabaseLoad(node)) return;
				const scope = enclosingFunction(node);

				if (sessionReadIn.has(scope)) {
					context.report({ node, message: "Read the session after the load. The session comes with the load, so reading it first takes the one load of the page." });
					return;
				}

				if (isInLoop(node, scope)) {
					context.report({ node, message: "Load outside the loop. Each load waits for the database again." });
					return;
				}
				if (scope && isCallback(scope)) {
					context.report({ node, message: "Load outside the callback. It may run more than once, and each load waits for the database again." });
					return;
				}
				if (astro && scope) {
					context.report({ node, message: "Load in the frontmatter itself, so the page loads once." });
					return;
				}

				const loads = (loadsIn.get(scope) ?? 0) + 1;
				loadsIn.set(scope, loads);
				if (loads > 1) context.report({ node, message: "Put this query in the first load. Each load waits for the database again, and a page fails on its second load." });
			},
		};
	},
});

const loadInPages = defineRule({
	meta: {
		type: "problem",
		docs: { description: "Only pages load from the database. Components get their data through props." },
	},
	create(context) {
		if (!isAstro(context.filename) || isPage(context.filename)) return {};
		return {
			CallExpression(node) {
				if (isDatabaseLoad(node)) context.report({ node, message: "Load in the page and pass the data to this component through props." });
			},
		};
	},
});

export default definePlugin({
	meta: { name: "database" },
	rules: { "one-load": oneLoad, "load-in-pages": loadInPages },
});
