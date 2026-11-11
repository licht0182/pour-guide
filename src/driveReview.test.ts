import { describe, expect, it } from 'vitest';
import { PRESETS } from './recipe';
import { compareDriveRecipes, needsDriveReview, remoteRecipes, replaceDriveEntries } from './driveReview';
import { mergeEntries } from './driveSync';

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
  it('shows additions, removals and changed fields including step notes', () => {
    const remote = [{ ...recipe, name: '바뀐 이름', steps: recipe.steps.map((step, i) => i ? step : { ...step, note: '다른 메모' }) }, { ...recipe, id: 'new' }];
    const difference = compareDriveRecipes([recipe, { ...recipe, id: 'local-only' }], remote);
    expect(difference[0].fields).toEqual(['이름', '추출 단계']);
    expect(difference.find(item => item.id === 'new')?.fields).toEqual(['Drive에만 있음']);
    expect(difference.find(item => item.id === 'local-only')?.fields).toEqual(['현재 기기에만 있음']);
  });
});
