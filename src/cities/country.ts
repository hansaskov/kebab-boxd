const countryNames = new Intl.DisplayNames("en", { type: "region", fallback: "none" });

// The English name of the country with the two-letter code, such as Denmark for DK. Intl throws on a code that
// is not two letters, so such a code has no name.
export function countryName(code: string | null | undefined): string | null {
	return (code?.match(/^[a-z]{2}$/i) && countryNames.of(code.toUpperCase())) || null;
}

// Where a City lies, such as "Texas, United States", to tell it from others of the same name.
export function regionAndCountry({ region, countryCode }: { region: string | null; countryCode: string }): string {
	return [region, countryName(countryCode)].filter(Boolean).join(", ");
}
