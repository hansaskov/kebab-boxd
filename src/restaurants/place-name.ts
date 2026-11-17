const nameMaxLength = 80;

export function cleanPlaceName(text: string): string | undefined {
	const name = text.trim();
	if (name.length <= nameMaxLength) return name || undefined;
	const words = name.slice(0, nameMaxLength + 1);
	const lastSpace = words.lastIndexOf(" ");
	return (lastSpace > 0 ? words.slice(0, lastSpace) : name.slice(0, nameMaxLength)).replace(/[\s,;:&|·–—-]+$/u, "");
}
