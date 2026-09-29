import type { CatalogEntry, ImportCandidate, ImportPlan, ImportRow } from '@fangyu/contracts';
import type { HandbookSession } from '@fangyu/domain';

export function normalizeName(value = ''): string {
  return value
    .normalize('NFKC')
    .replace(/[\s√●#]/g, '')
    .toLocaleLowerCase();
}

export function splitNames(value: string): string[] {
  const results: string[] = [];
  for (const source of value.replace(/^\ufeff/, '').split(/\r?\n|\r/)) {
    const line = source.trim().replace(/^(?:[-•·]\s*|\d+[.)．、]\s*|[（(]\d+[)）]\s*)/, '');
    let depth = 0;
    let part = '';
    for (const character of line) {
      if ('（(['.includes(character)) depth++;
      if ('）)]'.includes(character)) depth = Math.max(0, depth - 1);
      if (/[；;，,、]/.test(character) && !depth) {
        if (part.trim()) results.push(part.trim());
        part = '';
      } else {
        part += character;
      }
    }
    if (part.trim()) results.push(part.trim());
  }
  return results;
}

export function entryAliases(entry: CatalogEntry): string[] {
  const aliases = [entry.name, entry.code || '', ...entry.aliases];
  if (entry.categoryId === 'railway-station') {
    aliases.push(...aliases.map((alias) => alias.replace(/^(台铁|高铁)/, '').replace(/站$/, '')));
  }
  if (entry.categoryId === 'airport') {
    const code = entry.name.match(/^([A-Z]{3})(?=[^A-Za-z])/i)?.[1];
    if (code) aliases.push(code);
    aliases.push(
      ...aliases.map((alias) =>
        alias.replace(/^#?[A-Z]{3}/, '').replace(/(?:国际|民用|军民合用)?机场$/, ''),
      ),
    );
  }
  return [...new Set(aliases.filter(Boolean).map(normalizeName))];
}

export function entryCandidate(session: HandbookSession, entry: CatalogEntry): ImportCandidate {
  return {
    id: entry.id,
    name: session.view(entry).name,
    path: entry.regionIds.map((id) => session.index.paths.get(id) || '').join(' / '),
  };
}

export function namePlan(
  session: HandbookSession,
  text: string,
  categoryId: string,
  source: string,
): ImportPlan {
  const names = splitNames(text);
  if (names.length > 2000) throw Error('一次最多导入 2000 条名称，请分批处理。');
  const byAlias = new Map<string, CatalogEntry[]>();
  for (const entry of session.allEntries()) {
    if (entry.categoryId !== categoryId) continue;
    if (entry.regionIds.some((id) => session.index.regions.get(id)?.historical)) continue;
    const aliases = entryAliases(entry);
    if (entry.categoryId === 'airport') {
      const base = normalizeName(
        entry.name.replace(/^#?[A-Z]{3}/, '').replace(/(?:国际|民用|军民合用)?机场$/, ''),
      );
      for (const regionId of entry.regionIds) {
        for (const region of session.index
          .ancestors(regionId)
          .filter((region) => region.level < 2)) {
          const prefix = normalizeName(
            region.name.replace(/(?:特别行政区|自治区|自治州|地区|市|省)$/, ''),
          );
          if (prefix && base.startsWith(prefix) && base.length > prefix.length)
            aliases.push(base.slice(prefix.length));
        }
      }
    }
    for (const alias of aliases) {
      const entries = byAlias.get(alias) || [];
      entries.push(entry);
      byAlias.set(alias, entries);
    }
  }

  const rows = names.map((input): ImportRow => {
    const fields = input
      .split(/[|\t]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const matches = new Map<string, CatalogEntry>();
    fields.forEach((field, position) => {
      let key = normalizeName(field);
      if (categoryId === 'railway-station') key = key.replace(/站$/, '');
      if (categoryId === 'airport') key = key.replace(/(?:国际|民用|军民合用)?机场$/, '');
      for (const entry of byAlias.get(key) || []) {
        const path = normalizeName(entryCandidate(session, entry).path);
        if (
          fields.every(
            (qualifier, index) => index === position || path.includes(normalizeName(qualifier)),
          )
        ) {
          matches.set(entry.recordId, entry);
        }
      }
    });
    let candidates = [...matches.values()].map((entry) => entryCandidate(session, entry));
    if (categoryId === 'airport') {
      const groups = new Map<string, ImportCandidate>();
      for (const entry of matches.values()) {
        const code = entry.code || entry.name.match(/^([A-Z]{3})(?=[^A-Za-z])/i)?.[1] || '';
        const key = code + '|' + normalizeName(entry.name.replace(/^#?[A-Z]{3}/, ''));
        const existing = groups.get(key);
        if (existing) {
          existing.entryIds!.push(entry.id);
          existing.path += '；' + entryCandidate(session, entry).path;
        } else groups.set(key, { ...entryCandidate(session, entry), entryIds: [entry.id] });
      }
      candidates = [...groups.values()];
    }
    return {
      id: crypto.randomUUID(),
      source,
      input,
      kind: 'entry',
      candidates,
      choice: candidates.length === 1 ? 0 : -1,
      include: candidates.length === 1,
      state: 'arrived',
      result: candidates.length === 1 ? '唯一匹配' : candidates.length ? '同名待选' : '未匹配',
    };
  });
  return { title: '名称清单', baseRevision: session.revision, rows, notes: [], applied: false };
}
