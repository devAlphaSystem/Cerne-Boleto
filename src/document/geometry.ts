import type { NormalizedBounds } from "../candidates/types";
import type { RenderRecipe } from "../options";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedBounds(x: number, y: number, width: number, height: number): NormalizedBounds {
  const left = clamp01(x);
  const top = clamp01(y);
  const right = clamp01(x + width);
  const bottom = clamp01(y + height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Maps rendered bounds back through a recognition recipe's clockwise rotation.
 *
 * @param {NormalizedBounds} bounds - The bounds relative to the rotated render.
 * @param {0|90|180|270} rotation - The clockwise rotation applied by the recipe.
 * @returns {NormalizedBounds} The clamped bounds before recipe rotation.
 */
export function undoRecipeRotation(bounds: NormalizedBounds, rotation: RenderRecipe["rotation"]): NormalizedBounds {
  switch (rotation) {
    case 0:
      return normalizedBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    case 90:
      return normalizedBounds(bounds.y, 1 - bounds.x - bounds.width, bounds.height, bounds.width);
    case 180:
      return normalizedBounds(1 - bounds.x - bounds.width, 1 - bounds.y - bounds.height, bounds.width, bounds.height);
    case 270:
      return normalizedBounds(1 - bounds.y - bounds.height, bounds.x, bounds.height, bounds.width);
  }
}

/**
 * Maps encoded-image bounds through an EXIF orientation transform.
 *
 * @param {NormalizedBounds} bounds - The bounds relative to the encoded image axes.
 * @param {number} orientation - The EXIF orientation value from one through eight.
 * @returns {NormalizedBounds} The clamped bounds relative to the upright image.
 */
export function applyExifOrientationToBounds(bounds: NormalizedBounds, orientation: number): NormalizedBounds {
  switch (orientation) {
    case 2:
      return normalizedBounds(1 - bounds.x - bounds.width, bounds.y, bounds.width, bounds.height);
    case 3:
      return normalizedBounds(1 - bounds.x - bounds.width, 1 - bounds.y - bounds.height, bounds.width, bounds.height);
    case 4:
      return normalizedBounds(bounds.x, 1 - bounds.y - bounds.height, bounds.width, bounds.height);
    case 5:
      return normalizedBounds(bounds.y, bounds.x, bounds.height, bounds.width);
    case 6:
      return normalizedBounds(1 - bounds.y - bounds.height, bounds.x, bounds.height, bounds.width);
    case 7:
      return normalizedBounds(1 - bounds.y - bounds.height, 1 - bounds.x - bounds.width, bounds.height, bounds.width);
    case 8:
      return normalizedBounds(bounds.y, 1 - bounds.x - bounds.width, bounds.height, bounds.width);
    default:
      return normalizedBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }
}

/**
 * Places child bounds within a page-relative container region.
 *
 * @param {NormalizedBounds} bounds - The child bounds relative to the container.
 * @param {NormalizedBounds} container - The container bounds relative to the page.
 * @returns {NormalizedBounds} The clamped child bounds relative to the page.
 */
export function placeBoundsWithin(bounds: NormalizedBounds, container: NormalizedBounds): NormalizedBounds {
  return normalizedBounds(container.x + bounds.x * container.width, container.y + bounds.y * container.height, bounds.width * container.width, bounds.height * container.height);
}
