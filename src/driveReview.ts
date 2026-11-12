import { validateRecipe, withoutRecipeOrder } from './recipe';
import { mergeEntries, trackChanges } from './driveSync';
import type { Entry } from './driveSync';
import type { Recipe } from './types';

function contentKey(recipes: Recipe[]): string {
  return JSON.stringify(recipes.map(recipe => withoutRecipeOrder(validateRecipe(recipe))).sort((a, b) => a.id.localeCompare(b.id)));
}

function orderKey(recipes: Recipe[]): string {
  return JSON.stringify(recipes.map(recipe => recipe.id));
}

export function recipeKey(recipes: Recipe[]): string {
  // Moving a recipe is a real change, so the array position is compared too.
  // Stored order metadata is excluded: it restates the position it came from.
  return JSON.stringify({ order: orderKey(recipes), content: contentKey(recipes) });
}

export function entryKey(entries: Entry[]): string {
  return JSON.stringify(mergeEntries(entries));
}

// Stored order is only a transport for the other device's array position.
// Legacy entries have none, so they keep their deterministic ID order after the
// ordered ones instead of being reshuffled.
function positionedOrder(recipe: Recipe): number {
  return recipe.order ?? Number.MAX_SAFE_INTEGER;
}

export function remoteRecipes(entries: Entry[]): Recipe[] {
  const recipes = mergeEntries(entries).flatMap(entry => entry.recipe ? [entry.recipe] : []);
  const ordered = recipes.some(recipe => recipe.order !== undefined);
  if (!ordered) return recipes.map(withoutRecipeOrder);
  // Entries without a position predate ordering; keep them after the arranged
  // ones in their deterministic ID order instead of inventing a slot.
  return recipes
    .sort((a, b) => positionedOrder(a) - positionedOrder(b) || a.id.localeCompare(b.id))
    .map(withoutRecipeOrder);
}

export function needsDriveReview(local: Recipe[], remote: Entry[], baseline: Entry[] | null): boolean {
  if (!remote.length) return false;
  const remoteList = remoteRecipes(remote);
  // A snapshot uploaded before ordering existed carries no positions, so its ID
  // order says nothing about what the user arranged. Compare content only.
  const ordered = remote.some(entry => entry.recipe?.order !== undefined);
  if (contentKey(local) === contentKey(remoteList) && (!ordered || orderKey(local) === orderKey(remoteList))) return false;
  return baseline === null || entryKey(remote) !== entryKey(baseline);
}

// Explicit local replacement needs newer revisions, including tombstones for
// recipes present only in Drive. The previous immutable snapshots stay intact.
export function replaceDriveEntries(local: Recipe[], remote: Entry[], tracked: Entry[]): Entry[] {
  return trackChanges(mergeEntries(remote, tracked), local);
}

type TextField = Exclude<keyof Recipe, 'order'>;
const comparedFields: [TextField, string][] = [['name', '이름'], ['description', '설명'], ['coffee', '원두량'], ['temperature', '온도'], ['grind', '분쇄도'], ['dripper', '드리퍼'], ['filter', '필터'], ['category', '분류'], ['steps', '추출 단계']];

export interface RecipeDifference { id: string; local?: Recipe; remote?: Recipe; fields: string[] }
export function compareDriveRecipes(local: Recipe[], remote: Recipe[]): RecipeDifference[] {
  const left = new Map(local.map(recipe => [recipe.id, recipe]));
  const right = new Map(remote.map(recipe => [recipe.id, recipe]));
  const localPosition = new Map(local.map((recipe, index) => [recipe.id, index]));
  const remotePosition = new Map(remote.map((recipe, index) => [recipe.id, index]));
  const differences: RecipeDifference[] = [];
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id), b = right.get(id);
    if (!a) { differences.push({ id, remote: b, fields: ['Drive에만 있음'] }); continue; }
    if (!b) { differences.push({ id, local: a, fields: ['현재 기기에만 있음'] }); continue; }
    const fields = comparedFields
      .filter(([key]) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      .map(([, label]) => label);
    // A recipe can keep identical content and still sit somewhere else.
    if (localPosition.get(id) !== remotePosition.get(id)) fields.push('순서');
    if (fields.length) differences.push({ id, local: a, remote: b, fields });
  }
  return differences;
}
