/** Conservative display names; source identity and user-owned names are never rewritten. */
type Row = Record<string, any>;
export const seaTranslationFields = [
  'nameZh',
  'nameEn',
  'originalName',
  'nameTranslationStatus',
  'nameTranslationNeedsReview',
  'nameTranslationNote',
] as const;

export function localizeSeaName(target: Row, source: Row, changeDefaultName = true) {
  const previous = target.name;
  const original = source.nameOriginal || source.originalName || source.name || previous;
  const suppliedZh = source.nameZh || source.zh;
  const suppliedEn = source.nameEn || source.en;
  const oldChinese =
    !target.nameZh && /\p{Script=Han}/u.test(previous || '') && !/[·｜|]/u.test(previous)
      ? previous
      : undefined;
  target.nameZh ||= oldChinese || suppliedZh;
  target.nameEn ||= suppliedEn;
  target.originalName ||= original;
  target.nameTranslationStatus ||=
    source.nameTranslationStatus || source.translationStatus || 'provisional';
  target.nameTranslationNeedsReview ??=
    source.nameTranslationNeedsReview ??
    source.translationReviewRequired ??
    source.translationNeedsReview ??
    /provisional|pending|editorial|unresolved|transliterat/i.test(target.nameTranslationStatus);
  if (!target.nameZh || !target.nameEn) {
    target.nameTranslationNeedsReview = true;
    target.nameTranslationStatus = 'unresolved';
  }
  target.nameTranslationNote ||=
    source.nameTranslationNote ||
    source.translationNote ||
    (target.nameTranslationNeedsReview
      ? '译名待核；原文专名保留供详情与搜索，不将编辑译名视为官方译名。'
      : '采用来源提供的中英名称；原名保留。');
  if (changeDefaultName && target.nameZh && target.nameEn)
    target.name = `${target.nameZh} · ${target.nameEn}`;
  target.aliases = [
    ...new Set(
      [
        ...(target.aliases || []),
        previous,
        original,
        target.nameZh,
        target.nameEn,
        ...(source.aliases || []),
      ].filter((name) => typeof name === 'string' && name && name !== target.name),
    ),
  ];
  return Boolean(target.nameZh && target.nameEn);
}
