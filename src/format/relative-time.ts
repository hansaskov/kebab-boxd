const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

const formatters = {
  long: new Intl.RelativeTimeFormat("en", { numeric: "auto" }),
  narrow: new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" }),
};

export function formatRelativeTime(date: Date, now = new Date(), style: keyof typeof formatters = "long"): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);

  for (const [unit, unitSeconds] of units) {
    if (Math.abs(seconds) >= unitSeconds) {
      return formatters[style].format(Math.trunc(seconds / unitSeconds), unit);
    }
  }

  return "just now";
}

export function formatExactTime(date: Date): string {
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
}
