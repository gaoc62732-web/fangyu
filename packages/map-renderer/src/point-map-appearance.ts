/** Shared by tile and Canvas point exploration; ordinary region maps keep their theme. */
export const POINT_MAP_APPEARANCE = {
  visitedColor: '#57877a',
  unvisitedColor: '#82948b',
  partialColor: '#9b7c45',
  maskColor: '#f7f7f2',
  maskOpacity: 0.32,
  highlightColor: '#bd784b',
  highlightOpacity: 0.2,
  boundaryColor: '#8a9993',
  borderColor: '#6d7e76',
  boundaryOpacity: 0.7,
} as const;

export function pointVisitColors(colors: { flyover: string; transit: string; shortstay: string }) {
  const ink = (color: string) => {
    const channels = [1, 3, 5].map((position) => Number.parseInt(color.slice(position, position + 2), 16));
    return channels[0]! * .299 + channels[1]! * .587 + channels[2]! * .114 > 150 ? '#26352f' : '#fffefa';
  };
  return {
    visitedColor: colors.shortstay,
    unvisitedColor: colors.flyover,
    partialColor: colors.transit,
    visitedTextColor: ink(colors.shortstay),
    unvisitedTextColor: ink(colors.flyover),
    partialTextColor: ink(colors.transit),
  };
}
