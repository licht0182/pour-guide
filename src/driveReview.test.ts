import { describe, expect, it } from 'vitest';
import { PRESETS } from './recipe';
import { compareDriveRecipes, needsDriveReview, remoteRecipes, replaceDriveEntries } from './driveReview';
import { mergeEntries } from './driveSync';
import type { Entry } from './driveSync';
import type { Recipe } from './types';

const recipe = PRESETS[0];
const base = [{ id: recipe.id, recipe, revision: '0000000000000001-base' }];
const changed = [{ id: recipe.id, recipe: { ...recipe, coffee: recipe.coffee + 1 }, revision: '0000000000000002-remote' }];

describe('Drive overwrite review', () => {
  it('asks before applying another device change or a differing first connection', () => {
    expect(needsDriveReview([recipe], changed, base)).toBe(true);
    expect(needsDriveReview([recipe], changed, null)).toBe(true);
    expect(needsDriveReview([recipe], [{ ...changed[0], recipe: null }], base)).toBe(true);
  });
  it('does not ask for local-only edits, an empty Drive, or matching content', () => {
    expect(needsDriveReview([{ ...recipe, coffee: recipe.coffee + 2 }], base, base)).toBe(false);
    expect(needsDriveReview([recipe], [], null)).toBe(false);
    expect(needsDriveReview([recipe], [{ ...base[0], revision: '0000000000000003-other' }], null)).toBe(false);
  });
  it('explicit local replacement beats newer cloud revisions and removes cloud-only recipes', () => {
    const remote = [...changed, { ...changed[0], id: 'cloud-only', recipe: { ...recipe, id: 'cloud-only' } }];
    const resolved = replaceDriveEntries([recipe], remote, base);
    expect(remoteRecipes(mergeEntries(remote, resolved))).toEqual([recipe]);
    expect(resolved.find(entry => entry.id === 'cloud-only')?.recipe).toBeNull();
  });
  it('restores the arranged order from stored positions and compares order changes', () => {
    const second = { ...PRESETS[1], id: 'second' };
    const positioned = (list: Recipe[]): Entry[] => list.map((recipe, order) => ({
      id: recipe.id, revision: '0000000000000005-order', recipe: { ...recipe, order },
    }));
    const arranged = positioned([second, recipe]);
    expect(remoteRecipes(arranged).map(item => item.id)).toEqual([second.id, recipe.id]);
    expect(needsDriveReview([second, recipe], arranged, arranged)).toBe(false);
    const swapped = positioned([recipe, second]);
    expect(needsDriveReview([second, recipe], swapped, arranged)).toBe(true);
  });
  it('keeps legacy snapshots without positions from looking reordered', () => {
    const second = { ...PRESETS[1], id: 'second' };
    const legacy = [recipe, second].map((item, index) => ({ id: item.id, revision: `000000000000000${index}-legacy`, recipe: item }));
    expect(needsDriveReview([second, recipe], legacy, legacy)).toBe(false);
  });
  it('reports a recipe that only moved as a 순서 difference', () => {
    const second = { ...PRESETS[1], id: 'second' };
    const difference = compareDriveRecipes([second, recipe], [recipe, second]);
    expect(difference.map(item => ({ id: item.id, fields: item.fields }))).toEqual([
      { id: second.id, fields: ['순서'] },
      { id: recipe.id, fields: ['순서'] },
    ]);
  });
  it('shows additions, removals and changed fields including step notes', () => {
    const remote = [{ ...recipe, name: '바뀐 이름', steps: recipe.steps.map((step, i) => i ? step : { ...step, note: '다른 메모' }) }, { ...recipe, id: 'new' }];
    const difference = compareDriveRecipes([recipe, { ...recipe, id: 'local-only' }], remote);
    expect(difference[0].fields).toEqual(['이름', '추출 단계']);
    expect(difference.find(item => item.id === 'new')?.fields).toEqual(['Drive에만 있음']);
    expect(difference.find(item => item.id === 'local-only')?.fields).toEqual(['현재 기기에만 있음']);
  });
});
