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
// ICE/HOT is independent of the category, and unspecified means "not sorted".
const served: Recipe[] = [
  { ...a, id: 'ice1', name: 'ICE 아침', category: '아침', serve: 'ice' },
  { ...a, id: 'hot1', name: 'HOT 아침', category: '아침', serve: 'hot' },
  { ...b, id: 'plain1', name: '미지정 저녁', category: '저녁' },
  { ...b, id: 'hot2', name: 'HOT 저녁', category: '저녁', serve: 'hot' },
  { ...a, id: 'ice2', name: 'ICE 무분류', serve: 'ice' },
];

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

  it('shows every recipe until an ICE or HOT filter is chosen', () => {
    expect(names(filterRecipes(served, null, null))).toEqual(['ICE 아침', 'HOT 아침', '미지정 저녁', 'HOT 저녁', 'ICE 무분류']);
    expect(names(filterRecipes(served, null, 'ice'))).toEqual(['ICE 아침', 'ICE 무분류']);
    expect(names(filterRecipes(served, null, 'hot'))).toEqual(['HOT 아침', 'HOT 저녁']);
  });

  it('narrows to recipes that match both the category and the serving', () => {
    expect(names(filterRecipes(served, '아침', 'ice'))).toEqual(['ICE 아침']);
    expect(names(filterRecipes(served, '저녁', 'ice'))).toEqual([]);
    expect(names(filterRecipes(served, '', 'ice'))).toEqual(['ICE 무분류']);
  });

  it('swaps visible neighbours while a serving filter is active', () => {
    expect(names(moveRecipe(served, 'hot1', 1, null, 'hot'))).toEqual(['ICE 아침', 'HOT 저녁', '미지정 저녁', 'HOT 아침', 'ICE 무분류']);
    expect(names(moveRecipe(served, 'ice1', 1, null, 'ice'))).toEqual(['ICE 무분류', 'HOT 아침', '미지정 저녁', 'HOT 저녁', 'ICE 아침']);
    expect(moveRecipe(served, 'ice1', -1, null, 'ice')).toEqual(served);
  });

  it('keeps the current order at either end of a filtered list', () => {
    expect(moveRecipe(library, 'a1', -1, '아침')).toEqual(library);
    expect(moveRecipe(library, 'a3', 1, '아침')).toEqual(library);
    expect(moveRecipe(library, 'missing', 1, '아침')).toEqual(library);
  });
});
