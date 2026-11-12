import type { Recipe } from './types';

// null means all recipes; an empty string selects uncategorized recipes.
export function filterRecipes(recipes: Recipe[], category: string | null): Recipe[] {
  return category === null ? recipes : recipes.filter(recipe => (recipe.category ?? '') === category);
}

export function moveRecipe(recipes: Recipe[], id: string, direction: -1 | 1, category: string | null): Recipe[] {
  const visible = filterRecipes(recipes, category);
  const index = visible.findIndex(recipe => recipe.id === id);
  const neighbor = visible[index + direction];
  if (index < 0 || !neighbor) return recipes;
  const from = recipes.findIndex(recipe => recipe.id === id);
  const to = recipes.findIndex(recipe => recipe.id === neighbor.id);
  const next = [...recipes];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
