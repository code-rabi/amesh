const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.345],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY]
];

export function relativeTime(isoOrNull: string | null | undefined, now: number = Date.now()): string {
  if (!isoOrNull) return "never";
  const then = Date.parse(isoOrNull);
  if (Number.isNaN(then)) return "never";
  let delta = (then - now) / 1000;
  for (const [unit, span] of units) {
    if (Math.abs(delta) < span) {
      return formatter.format(Math.round(delta), unit);
    }
    delta /= span;
  }
  return "long ago";
}
