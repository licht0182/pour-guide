import { validateRecipe } from './recipe';
import { mergeEntries, trackChanges } from './driveSync';
import type { Entry } from './driveSync';
import type { Recipe } from './types';

export function recipeKey(recipes: Recipe[]): string {
  return JSON.stringify(recipes.map(validateRecipe).sort((a, b) => a.id.localeCompare(b.id)));
}

export function entryKey(entries: Entry[]): string {
  return JSON.stringify(mergeEntries(entries));
}

export function remoteRecipes(entries: Entry[]): Recipe[] {
  return mergeEntries(entries).flatMap(entry => entry.recipe ? [entry.recipe] : []);
}

export function needsDriveReview(local: Recipe[], remote: Entry[], baseline: Entry[] | null): boolean {
  if (!remote.length || recipeKey(local) === recipeKey(remoteRecipes(remote))) return false;
  return baseline === null || entryKey(remote) !== entryKey(baseline);
}

// Explicit local replacement needs newer revisions, including tombstones for
// recipes present only in Drive. The previous immutable snapshots stay intact.
export function replaceDriveEntries(local: Recipe[], remote: Entry[], tracked: Entry[]): Entry[] {
  return trackChanges(mergeEntries(remote, tracked), local);
}

export interface RecipeDifference { id: string; local?: Recipe; remote?: Recipe; fields: string[] }
export function compareDriveRecipes(local: Recipe[], remote: Recipe[]): RecipeDifference[] {
  const left = new Map(local.map(recipe => [recipe.id, recipe]));
  const right = new Map(remote.map(recipe => [recipe.id, recipe]));
  const labels: [keyof Recipe, string][] = [['name', '이름'], ['description', '설명'], ['coffee', '원두량'], ['temperature', '온도'], ['grind', '분쇄도'], ['dripper', '드리퍼'], ['filter', '필터'], ['steps', '추출 단계']];
  return [...new Set([...left.keys(), ...right.keys()])].flatMap(id => {
    const a = left.get(id), b = right.get(id);
    const fields = !a ? ['Drive에만 있음'] : !b ? ['현재 기기에만 있음'] : labels.filter(([key]) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).map(([, label]) => label);
    return fields.length ? [{ id, local: a, remote: b, fields }] : [];
  });
}
