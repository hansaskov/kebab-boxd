export const maxStars = 5;

export function toStars(rating: number): number {
  return rating / 2;
}

export function splitStars(rating: number): { full: number; half: boolean } {
  const stars = toStars(rating);
  const full = Math.floor(stars);
  return { full, half: stars > full };
}

export function formatAverageStars(ratingAvg: number): string {
  return toStars(ratingAvg).toFixed(1);
}

export function describeStars(stars: number | string): string {
  return `${stars} out of ${maxStars} stars`;
}
