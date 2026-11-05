export function pointCategoryAppearance(id: string, name = '') {
  const text = id + ' ' + name;
  if (/world-heritage|世界遗产/.test(text)) return { icon: 'world-heritage', color: '#527d69' };
  if (/heritage|文物|文保|遗迹/.test(text)) return { icon: 'heritage', color: '#a47746' };
  if (/airport|机场/.test(text)) return { icon: 'airport', color: '#597eaa' };
  if (/urban-rail|轨道|地铁/.test(text)) return { icon: 'metro', color: '#8873a2' };
  if (/railway|铁路|车站/.test(text)) return { icon: 'railway', color: '#6a8192' };
  if (/football|stadium|球场/.test(text)) return { icon: 'stadium', color: '#628a60' };
  if (/historic-city|历史|古城/.test(text)) return { icon: 'city', color: '#a17668' };
  if (/mountain|山|自然|公园/.test(text)) return { icon: 'mountain', color: '#638977' };
  return { icon: 'location', color: '#8c7d62' };
}
