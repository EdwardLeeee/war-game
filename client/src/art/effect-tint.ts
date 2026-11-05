// 晶砲預警圈 in the caster's colour (D-129): pure, for the unit tests.

/**
 * A white picture's tint from a player's colour (D-129, ui's 晶砲預警圈 B point 5): each channel of
 * `colour` (0–1) brought up to its brightest with hue and saturation kept (× value ÷ its largest
 * channel: the player colour itself is darker than the old orange and goes grey over the grass),
 * then mixed towards white by `white`.
 */
export function effectTint(colour: number, value: number, white: number): number {
  const p = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff].map((v) => v / 255);
  const top = Math.max(...p);
  const c = p.map((v) => (top > 0 ? (v * value) / top : value));
  const [r, g, b] = c.map((v) => Math.round(255 * Math.min(1, Math.max(0, v + (1 - v) * white))));
  return (r << 16) | (g << 8) | b;
}
