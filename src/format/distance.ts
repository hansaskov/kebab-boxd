const kilometres = new Intl.NumberFormat("en", { style: "unit", unit: "kilometer", maximumFractionDigits: 1 });
const metres = new Intl.NumberFormat("en", { style: "unit", unit: "meter", maximumFractionDigits: 0 });

export function formatDistance(meters: number): string {
	if (meters < 1000) return metres.format(Math.max(10, Math.round(meters / 10) * 10));
	return kilometres.format(meters / 1000);
}
