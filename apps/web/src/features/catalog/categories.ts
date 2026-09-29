export const CATEGORY_GROUPS = [
  {
    name: '自然风景',
    icon: '山',
    ids: ['global-geopark', 'national-park', 'scenic-area', 'national-geopark', 'five-a-scenic'],
  },
  {
    name: '历史人文',
    icon: '古',
    ids: [
      'world-heritage',
      'historic-city',
      'historic-settlement',
      'cultural-monument',
      'national-treasure',
      'historic-site',
    ],
  },
  { name: '博物馆', icon: '馆', ids: ['first-class-museum', 'museum'] },
  { name: '交通', icon: '行', ids: ['railway-station', 'airport', 'urban-rail'] },
];
export function categoryIcon(id: string) {
  return CATEGORY_GROUPS.find((g) => g.ids.includes(id))?.icon || '地';
}
