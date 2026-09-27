/**
 * World Handicap System rounding: round to the nearest whole number, .5 rounds up
 * (toward positive infinity). So 12.5 -> 13 and -2.5 -> -2.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
