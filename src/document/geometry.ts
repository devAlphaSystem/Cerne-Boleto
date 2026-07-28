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

/** Converts bounds from a recipe-rotated canvas back to its unrotated page. */
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

/** Maps a raw-image rectangle into the EXIF-upright image coordinate space. */
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

export function placeBoundsWithin(bounds: NormalizedBounds, container: NormalizedBounds): NormalizedBounds {
  return normalizedBounds(container.x + bounds.x * container.width, container.y + bounds.y * container.height, bounds.width * container.width, bounds.height * container.height);
}
