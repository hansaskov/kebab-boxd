export const searchMaxLength = 100;

export function parseSearch(params: URLSearchParams): string {
	return (params.get("q") ?? "").trim().slice(0, searchMaxLength);
}

export function parseOption<const Option extends string>(params: URLSearchParams, name: string, options: readonly Option[], fallback: Option): Option {
	return options.find((option) => option === params.get(name)) ?? fallback;
}

export function parseId(param: string | undefined): number | undefined {
	if (!param || !/^[1-9]\d*$/.test(param)) return undefined;
	const id = Number(param);
	return Number.isSafeInteger(id) ? id : undefined;
}
