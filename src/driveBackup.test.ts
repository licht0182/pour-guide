import { describe, expect, it } from 'vitest';
import { decodeBackup, encodeBackup, MAX_BACKUP_BYTES, mergeBackup } from './driveBackup';
import { PRESETS } from './recipe';
import type { Library } from './storage';

const library: Library = { recipes: PRESETS, activeId: PRESETS[1].id };
const documentFor = (recipes: unknown[], extra = {}) => JSON.stringify({ format: 'pour-guide', version: 1, recipes, activeId: PRESETS[0].id, ...extra });

describe('Drive backup validation and merge', () => {
  it('round trips the complete library and active recipe', () => {
    expect(decodeBackup(encodeBackup(library))).toEqual(library);
  });
  it('preserves the optional filter through a backup round trip', () => {
    const filtered = { ...PRESETS[0], filter: '하리오 V60' };
    const restored = decodeBackup(encodeBackup({ recipes: [filtered, PRESETS[1]], activeId: filtered.id }));
    expect(restored.recipes[0].filter).toBe('하리오 V60');
    expect('filter' in restored.recipes[1]).toBe(false);
  });
  it('preserves categories and the arranged array order through a backup round trip', () => {
    const first = { ...PRESETS[1], id: 'first', category: '아침 커피' };
    const second = { ...PRESETS[0], category: '저녁' };
    const restored = decodeBackup(encodeBackup({ recipes: [first, second], activeId: second.id }));
    expect(restored.recipes.map(recipe => [recipe.id, recipe.category])).toEqual([['first', '아침 커피'], [second.id, '저녁']]);
    expect(restored.activeId).toBe(second.id);
  });
  it('merges a backup in its own order without duplicating recipes moved locally', () => {
    const current: Library = { recipes: [PRESETS[1], PRESETS[0]], activeId: PRESETS[1].id };
    const incoming: Library = { recipes: [{ ...PRESETS[0], order: 0 }, PRESETS[2], PRESETS[1]], activeId: PRESETS[0].id };
    const merged = mergeBackup(current, incoming);
    // Existing recipes keep their local order; only genuinely new ones append.
    expect(merged.recipes.map(recipe => recipe.id)).toEqual([PRESETS[1].id, PRESETS[0].id, PRESETS[2].id]);
    expect(merged.recipes.some(recipe => recipe.order !== undefined)).toBe(false);
  });
  it('rejects invalid, unsupported, oversized and partially corrupt backups', () => {
    for (const json of ['{', 'null', documentFor([]), documentFor(PRESETS, { version: 2 }), documentFor([...PRESETS, { id: 'bad' }]), documentFor([PRESETS[0], PRESETS[0]]), ' '.repeat(MAX_BACKUP_BYTES + 1)]) {
      expect(() => decodeBackup(json)).toThrow();
    }
    expect(() => encodeBackup({ recipes: Array.from({ length: 1001 }, (_, i) => ({ ...PRESETS[0], id: String(i) })), activeId: '0' })).toThrow();
  });
  it('falls back to a valid active ID', () => {
    expect(decodeBackup(documentFor(PRESETS, { activeId: 'missing' })).activeId).toBe(PRESETS[0].id);
  });
  it('preserves local edits, copies conflicts, and skips repeats on subsequent imports', () => {
    const edited = { ...PRESETS[0], name: '내 수정 레시피' };
    const current = { recipes: [edited], activeId: edited.id };
    const merged = mergeBackup(current, library);
    expect(merged.recipes).toHaveLength(PRESETS.length + 1);
    expect(merged.recipes[0]).toBe(edited);
    expect(merged.activeId).toBe(current.activeId);
    expect(new Set(merged.recipes.map(recipe => recipe.id)).size).toBe(merged.recipes.length);
    expect(mergeBackup(merged, library)).toEqual(merged);
    expect(current.recipes).toEqual([edited]);
  });
});
