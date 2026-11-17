import { definePlugin, defineRule } from "@oxlint/plugins";

const directive = /^\/ <reference /;

const none = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Code has no comments. Name things so the code explains itself." },
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (comment.type === "Line" && directive.test(comment.value)) continue;
					context.report({
						loc: comment.loc,
						message: "Remove the comment. Name things so the code explains itself.",
					});
				}
			},
		};
	},
});

export default definePlugin({
	meta: { name: "comments" },
	rules: { none },
});
