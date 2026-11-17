export const searchMaxLength = 100;

// The text to search for. A longer one is cut, not refused.
export function parseSearch(params: URLSearchParams): string {
	return (params.get("q") ?? "").trim().slice(0, searchMaxLength);
}

// The option the parameter names, or the fallback when it names none of them.
export function parseOption<const Option extends string>(params: URLSearchParams, name: string, options: readonly Option[], fallback: Option): Option {
	return options.find((option) => option === params.get(name)) ?? fallback;
}

// The id in a path or a query, or undefined when it is not a positive whole number.
export function parseId(param: string | undefined): number | undefined {
	if (!param || !/^[1-9]\d*$/.test(param)) return undefined;
	const id = Number(param);
	return Number.isSafeInteger(id) ? id : undefined;
}
