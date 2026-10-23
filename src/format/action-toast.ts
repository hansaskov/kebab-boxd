import type { Toast } from "@src/components/Toast.astro";

type ActionResult = { error?: { message: string } | undefined } | undefined;

export function failureToast(result: ActionResult, title: string): Toast | undefined {
	return result?.error ? { kind: "title", variant: "error", title, text: result.error.message } : undefined;
}

export function resultToast(result: ActionResult, failedTitle: string, success: { title: string; text: string }): Toast | undefined {
	if (!result) return undefined;
	return failureToast(result, failedTitle) ?? { kind: "title", ...success };
}
