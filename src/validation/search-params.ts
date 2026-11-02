export const searchMaxLength = 100;

// The text to search for. A longer one is cut, not refused.
export function parseSearch(params: URLSearchParams): string {
	return (params.get("q") ?? "").trim().slice(0, searchMaxLength);
}

// The option the parameter names, or the fallback when it names none of them.
export function parseOption<const Option extends string>(params: URLSearchParams, name: string, options: readonly Option[], fallback: Option): Option {
	return options.find((option) => option === params.get(name)) ?? fallback;
}
