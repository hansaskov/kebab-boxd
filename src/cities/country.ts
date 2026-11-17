const countryNames = new Intl.DisplayNames("en", { type: "region", fallback: "none" });

export function countryName(code: string | null | undefined): string | null {
	return (code?.match(/^[a-z]{2}$/i) && countryNames.of(code.toUpperCase())) || null;
}

export function regionAndCountry({ region, countryCode }: { region: string | null; countryCode: string }): string {
	return [region, countryName(countryCode)].filter(Boolean).join(", ");
}
