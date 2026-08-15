const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(color: string): [number, number, number] | null {
  if (!HEX_COLOR.test(color)) return null;
  const hex = color.slice(1);
  const expanded = hex.length === 3 ? hex.split('').map(value => value + value).join('') : hex;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function hex(channels: [number, number, number]) {
  return '#' + channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
}

function luminance(color: string): number | null {
  const channels = rgb(color);
  if (!channels) return null;
  const linear = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function getContrastRatio(firstColor: string, secondColor: string) {
  const first = luminance(firstColor);
  const second = luminance(secondColor);
  if (first === null || second === null) return 1;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixEmailColor(color: string, target: string, targetWeight: number): string {
  const sourceRgb = rgb(color);
  const targetRgb = rgb(target);
  if (!sourceRgb || !targetRgb) return target;
  const weight = Math.max(0, Math.min(1, targetWeight));
  return hex([
    sourceRgb[0] * (1 - weight) + targetRgb[0] * weight,
    sourceRgb[1] * (1 - weight) + targetRgb[1] * weight,
    sourceRgb[2] * (1 - weight) + targetRgb[2] * weight,
  ]);
}

export function lightenEmailColor(color: string, amount: number) {
  return mixEmailColor(color, '#ffffff', amount);
}

export function darkenEmailColor(color: string, amount: number) {
  return mixEmailColor(color, '#000000', amount);
}

export function getReadableTextColor(
  backgroundColor: string,
  lightColor = '#ffffff',
  darkColor = '#111827',
): string {
  if (!rgb(backgroundColor) || !rgb(lightColor) || !rgb(darkColor)) return darkColor;
  const lightContrast = getContrastRatio(backgroundColor, lightColor);
  const darkContrast = getContrastRatio(backgroundColor, darkColor);
  return lightContrast >= darkContrast ? lightColor : darkColor;
}

export function ensureReadableTextColor(
  backgroundColor: string,
  preferredColor: string,
  minimumContrast = 4.5,
): string {
  return getContrastRatio(backgroundColor, preferredColor) >= minimumContrast
    ? preferredColor
    : getReadableTextColor(backgroundColor);
}
