import { describe, expect, it } from 'vitest';
import { exportWorkbook, workbookPlan } from '@fangyu/import-export';
import { applyRows } from '../features/imports/parse.js';
import { airport, createSession, dongcheng } from './fixtures.js';

describe('Excel loading and record roundtrip', () => {
  it('preserves visit state, edited names and notes through a real XLSX file', async () => {
    const source = createSession();
    source.transaction(() => {
      source.markEntry(airport, true, dongcheng);
      source.editEntry(airport, '个人机场名称', '旅行备注');
    });
    const bytes = await exportWorkbook(source);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const restored = createSession();
    const plan = await workbookPlan(restored, new Uint8Array(bytes).buffer, 'roundtrip.xlsx');
    expect(plan.notes).toEqual([]);
    restored.transaction(() => {
      applyRows(restored, plan);
    });
    expect(restored.view(restored.entry(airport))).toMatchObject({
      visited: true,
      name: '个人机场名称',
      note: '旅行备注',
    });
    expect(restored.arrived(dongcheng)).toBe(true);
    restored.undo();
    expect(restored.view(restored.entry(airport)).visited).toBe(false);
  });
});
