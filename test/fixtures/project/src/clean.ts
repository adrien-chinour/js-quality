export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  return value > max ? max : value;
}
