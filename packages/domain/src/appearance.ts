import type { VisitState } from '@fangyu/contracts';

export type MapColors = Record<VisitState | 'unmapped', string>;

export function blendHex(color: string, target: string, weight: number): string {
  const channel = (value: string, position: number) =>
    Number.parseInt(value.slice(position, position + 2), 16);
  const channels = [1, 3, 5].map((position) => {
    const mixed = channel(color, position) * (1 - weight) + channel(target, position) * weight;
    return Math.round(mixed).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('');
}

export function tonalColors(base: string): MapColors {
  return {
    unvisited: blendHex(base, '#ffffff', 0.93),
    flyover: blendHex(base, '#ffffff', 0.78),
    transit: blendHex(base, '#ffffff', 0.6),
    arrived: blendHex(base, '#ffffff', 0.36),
    shortstay: base,
    resident: blendHex(base, '#172523', 0.38),
    unmapped: '#d9d2df',
  };
}

export const PALETTES = {
  jade: { name: '青绿山水', colors: tonalColors('#438d6a') },
  ink: { name: '水墨丹青', colors: tonalColors('#596c77') },
  autumn: { name: '金秋山河', colors: tonalColors('#af7539') },
  ocean: { name: '碧海晴空', colors: tonalColors('#337fae') },
  contrast: { name: '朱砂丹霞', colors: tonalColors('#af4e4b') },
};

export function darkColors(colors: MapColors): MapColors {
  return {
    ...colors,
    unvisited: '#293941',
    flyover: blendHex(colors.shortstay, '#293941', 0.81),
    transit: blendHex(colors.shortstay, '#293941', 0.58),
    arrived: blendHex(colors.shortstay, '#edf8f5', 0.3),
    shortstay: blendHex(colors.shortstay, '#edf8f5', 0.52),
    resident: blendHex(colors.shortstay, '#edf8f5', 0.76),
    unmapped: '#42464d',
  };
}
