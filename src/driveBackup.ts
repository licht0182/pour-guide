import { validateRecipe, withoutRecipeOrder } from './recipe';
import type { Library } from './storage';
import type { Recipe } from './types';

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export function encodeBackup(library: Library): string {
  const json = JSON.stringify({ format: 'pour-guide', version: 1, savedAt: new Date().toISOString(), ...library });
  if (new Blob([json]).size > MAX_BACKUP_BYTES) throw new Error('보관함이 너무 큽니다. 백업은 5MB까지 가능합니다.');
  decodeBackup(json);
  return json;
}

export function decodeBackup(json: string): Library {
  if (new Blob([json]).size > MAX_BACKUP_BYTES) throw new Error('백업 파일은 5MB까지 가져올 수 있습니다.');
  let value;
  try { value = JSON.parse(json); }
  catch { throw new Error('백업의 JSON 형식이 올바르지 않습니다.'); }
  if (!value || value.format !== 'pour-guide' || value.version !== 1 || !Array.isArray(value.recipes) || !value.recipes.length || value.recipes.length > 1000) {
    throw new Error('지원하지 않는 Pour Guide 백업입니다.');
  }
  // The array order is preserved by the JSON document itself, so a stale index
  // is dropped rather than imported into local state.
  const recipes: Recipe[] = value.recipes.map((recipe: unknown) => withoutRecipeOrder(validateRecipe(recipe)));
  if (new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) throw new Error('백업에 중복된 레시피 ID가 있습니다.');
  return { recipes, activeId: recipes.some(recipe => recipe.id === value.activeId) ? value.activeId : recipes[0].id };
}

// Compare validated content without the ID or transport order so a conflicting
// copy is not added twice.
function content(recipe: Recipe): string {
  const { id: _id, ...rest } = withoutRecipeOrder(validateRecipe(recipe));
  return JSON.stringify(rest);
}

export function mergeBackup(current: Library, incoming: Library): Library {
  const recipes = [...current.recipes];
  const known = new Set(recipes.map(content));
  const ids = new Set(recipes.map(recipe => recipe.id));
  for (const recipe of incoming.recipes) {
    const key = content(recipe);
    if (known.has(key)) continue;
    let id = recipe.id;
    while (ids.has(id)) id = crypto.randomUUID();
    recipes.push({ ...recipe, id });
    ids.add(id);
    known.add(key);
  }
  return { recipes, activeId: current.activeId };
}
