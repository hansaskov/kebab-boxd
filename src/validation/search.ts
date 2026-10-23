export const searchMaxLength = 100;

export function parseSearch(params: URLSearchParams): string {
	return (params.get("q") ?? "").trim().slice(0, searchMaxLength);
}
