export const maxStars = 5;

export function toStars(rating: number): number {
  return rating / 2;
}

export type StarFill = "full" | "half" | "empty";

export function starFills(rating: number): StarFill[] {
  const stars = toStars(rating);
  return Array.from({ length: maxStars }, (_, index) => (stars >= index + 1 ? "full" : stars > index ? "half" : "empty"));
}

export function formatAverageStars(ratingAvg: number): string {
  return toStars(ratingAvg).toFixed(1);
}

export function describeStars(stars: number | string): string {
  return `${stars} out of ${maxStars} stars`;
}
