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
