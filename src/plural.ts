export function plural(amount: number, word: string): string {
	return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}
