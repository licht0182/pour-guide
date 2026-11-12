import type { Recipe, ServeTemperature } from './types';

// null means all recipes; an empty string selects uncategorized recipes.
export function filterRecipes(recipes: Recipe[], category: string | null, serve: ServeTemperature | null = null): Recipe[] {
  if (category === null && serve === null) return recipes;
  return recipes.filter(recipe => (category === null || (recipe.category ?? '') === category)
    && (serve === null || recipe.serve === serve));
}

export function moveRecipe(recipes: Recipe[], id: string, direction: -1 | 1, category: string | null, serve: ServeTemperature | null = null): Recipe[] {
  const visible = filterRecipes(recipes, category, serve);
  const index = visible.findIndex(recipe => recipe.id === id);
  const neighbor = visible[index + direction];
  if (index < 0 || !neighbor) return recipes;
  const from = recipes.findIndex(recipe => recipe.id === id);
  const to = recipes.findIndex(recipe => recipe.id === neighbor.id);
  const next = [...recipes];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
