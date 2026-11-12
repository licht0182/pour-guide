import { describe, expect, it } from 'vitest';
import { PRESETS } from './recipe';
import { filterRecipes, moveRecipe } from './recipeOrganization';
import type { Recipe } from './types';

const [a, b] = PRESETS;
const library: Recipe[] = [
  { ...a, id: 'a1', name: 'A1', category: '아침' },
  { ...b, id: 'b1', name: 'B1', category: '저녁' },
  { ...a, id: 'a2', name: 'A2', category: '아침' },
  { ...b, id: 'b2', name: 'B2' },
  { ...a, id: 'a3', name: 'A3', category: '아침' },
];
const names = (recipes: Recipe[]) => recipes.map(recipe => recipe.name);

describe('recipe organization', () => {
  it('filters to a category without changing the stored order', () => {
    expect(names(filterRecipes(library, null))).toEqual(['A1', 'B1', 'A2', 'B2', 'A3']);
    expect(names(filterRecipes(library, '아침'))).toEqual(['A1', 'A2', 'A3']);
    expect(names(filterRecipes(library, ''))).toEqual(['B2']);
  });

  it('swaps only visible neighbours inside the full order', () => {
    expect(names(moveRecipe(library, 'a2', -1, '아침'))).toEqual(['A2', 'B1', 'A1', 'B2', 'A3']);
    expect(names(moveRecipe(library, 'a2', 1, '아침'))).toEqual(['A1', 'B1', 'A3', 'B2', 'A2']);
  });

  it('keeps the current order at either end of a filtered list', () => {
    expect(moveRecipe(library, 'a1', -1, '아침')).toEqual(library);
    expect(moveRecipe(library, 'a3', 1, '아침')).toEqual(library);
    expect(moveRecipe(library, 'missing', 1, '아침')).toEqual(library);
  });
});
