// A longer name is shortened, not refused: it is still the place that was found.
const nameMaxLength = 80;

// The name of a place as it is stored: trimmed, and cut at the last word that fits, without the comma or dash
// before it. Undefined when nothing is left.
export function cleanPlaceName(text: string): string | undefined {
	const name = text.trim();
	if (name.length <= nameMaxLength) return name || undefined;
	const words = name.slice(0, nameMaxLength + 1);
	const lastSpace = words.lastIndexOf(" ");
	return (lastSpace > 0 ? words.slice(0, lastSpace) : name.slice(0, nameMaxLength)).replace(/[\s,;:&|·–—-]+$/u, "");
}
