// The amount with the word, which gets an s unless the amount is one: "1 restaurant", "2 restaurants".
export function plural(amount: number, word: string): string {
	return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}
