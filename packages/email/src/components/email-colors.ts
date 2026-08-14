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

function luminance(color: string): number | null {
  const channels = rgb(color);
  if (!channels) return null;
  const linear = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(first: number, second: number) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getReadableTextColor(
  backgroundColor: string,
  lightColor = '#ffffff',
  darkColor = '#111827',
): string {
  const background = luminance(backgroundColor);
  const light = luminance(lightColor);
  const dark = luminance(darkColor);
  if (background === null || light === null || dark === null) return darkColor;
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? lightColor : darkColor;
}
