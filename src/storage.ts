import type { Recipe } from './types';
import { PRESETS, parseRecipe } from './recipe';

const LIBRARY_KEY = 'pour-guide.library.v1';

export interface Library {
  recipes: Recipe[];
  activeId: string;
}

function fallbackLibrary(): Library {
  return { recipes: PRESETS, activeId: PRESETS[0].id };
}

export function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return fallbackLibrary();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('recipes' in value) || !('activeId' in value)) {
      return fallbackLibrary();
    }
    const candidates = value.recipes;
    if (!Array.isArray(candidates) || !candidates.length) return fallbackLibrary();
    const recipes = candidates.flatMap(item => {
      try {
        return [parseRecipe(JSON.stringify(item))];
      } catch {
        return [];
      }
    });
    if (!recipes.length) return fallbackLibrary();
    const savedId = value.activeId;
    return {
      recipes,
      activeId: typeof savedId === 'string' && recipes.some(recipe => recipe.id === savedId)
        ? savedId
        : recipes[0].id,
    };
  } catch {
    return fallbackLibrary();
  }
}

export function saveLibrary(library: Library): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

export function downloadRecipe(recipe: Recipe): void {
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${recipe.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'recipe'}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readRecipeFile(file: File): Promise<Recipe> {
  if (file.size > 512 * 1024) throw new Error('파일이 너무 큽니다. 512KB 이하의 JSON 파일을 선택해 주세요.');
  return parseRecipe(await file.text());
}
