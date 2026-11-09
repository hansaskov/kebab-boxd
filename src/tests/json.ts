// JSON that keeps dates, for values that travel between the tests and a Worker in Miniflare.

const dateKey = "$date";

export function toJson(value: unknown): string {
	return JSON.stringify(value, function (key, item: unknown) {
		const original: unknown = (this as Record<string, unknown>)[key];
		return original instanceof Date ? { [dateKey]: original.toISOString() } : item;
	});
}

export function fromJson(text: string): unknown {
	return JSON.parse(text, (_key, item: unknown) =>
		typeof item === "object" && item !== null && dateKey in item && typeof item[dateKey] === "string" ? new Date(item[dateKey]) : item,
	);
}
