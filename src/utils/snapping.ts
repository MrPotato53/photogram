import type { Element as AppElement, Guide } from '../types';
import type { SnapSettings } from '../stores/snapStore';

export interface StaticGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  type: 'canvas' | 'margin' | 'grid';
}

interface SnapLine {
  position: number;
  type: 'edge' | 'center' | 'margin' | 'grid';
}

interface SnapLines {
  vertical: SnapLine[];
  horizontal: SnapLine[];
}

interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

interface TransformSnapResult {
  width: number;
  height: number;
  x: number;
  y: number;
  guides: Guide[];
}

const SNAP_THRESHOLD = 8; // pixels

/**
 * Calculate all snap lines based on settings
 */
export function calculateSnapLines(
  elements: AppElement[],
  currentElementId: string,
  canvasWidth: number,
  canvasHeight: number,
  settings: SnapSettings,
  slideWidth?: number, // If provided, adds per-slide snap lines
  numSlides?: number
): SnapLines {
  const vertical: SnapLine[] = [];
  const horizontal: SnapLine[] = [];

  // Canvas edges and center (for single slide view, or use slideWidth for multi-slide)
  if (settings.canvas.enabled) {
    if (slideWidth && numSlides) {
      // Multi-slide: add snap lines per slide
      for (let i = 0; i < numSlides; i++) {
        const slideLeft = i * slideWidth;
        const slideCenter = slideLeft + slideWidth / 2;
        const slideRight = (i + 1) * slideWidth;

        vertical.push(
          { position: slideLeft, type: 'edge' },
          { position: slideCenter, type: 'center' }
        );
        if (i === numSlides - 1) {
          vertical.push({ position: slideRight, type: 'edge' });
        }
      }
      // Horizontal is same for all slides
      horizontal.push(
        { position: 0, type: 'edge' },
        { position: canvasHeight / 2, type: 'center' },
        { position: canvasHeight, type: 'edge' }
      );
    } else {
      vertical.push(
        { position: 0, type: 'edge' },
        { position: canvasWidth / 2, type: 'center' },
        { position: canvasWidth, type: 'edge' }
      );
      horizontal.push(
        { position: 0, type: 'edge' },
        { position: canvasHeight / 2, type: 'center' },
        { position: canvasHeight, type: 'edge' }
      );
    }
  }

  // Margin guides
  if (settings.margin.enabled && settings.margin.value > 0) {
    const margin = settings.margin.value;
    if (slideWidth && numSlides) {
      // Multi-slide: add margin lines per slide
      for (let i = 0; i < numSlides; i++) {
        const slideLeft = i * slideWidth;
        vertical.push(
          { position: slideLeft + margin, type: 'margin' },
          { position: slideLeft + slideWidth - margin, type: 'margin' }
        );
      }
      horizontal.push(
        { position: margin, type: 'margin' },
        { position: canvasHeight - margin, type: 'margin' }
      );
    } else {
      vertical.push(
        { position: margin, type: 'margin' },
        { position: canvasWidth - margin, type: 'margin' }
      );
      horizontal.push(
        { position: margin, type: 'margin' },
        { position: canvasHeight - margin, type: 'margin' }
      );
    }
  }

  // Grid guides (divisions)
  if (settings.grid.enabled) {
    const hDivisions = settings.grid.horizontal;
    const vDivisions = settings.grid.vertical;
    const gridMargin = settings.grid.margin;
    const halfMargin = gridMargin / 2;

    if (slideWidth && numSlides) {
      // Multi-slide: add grid lines per slide
      for (let slideIdx = 0; slideIdx < numSlides; slideIdx++) {
        const slideLeft = slideIdx * slideWidth;
        // Vertical grid lines within each slide
        for (let i = 1; i < vDivisions; i++) {
          const basePosition = slideLeft + (slideWidth * i) / vDivisions;
          if (gridMargin > 0) {
            // Split into two guides for gutter
            vertical.push(
              { position: basePosition - halfMargin, type: 'grid' },
              { position: basePosition + halfMargin, type: 'grid' }
            );
          } else {
            vertical.push({ position: basePosition, type: 'grid' });
          }
        }
      }
      // Horizontal grid lines (same for all slides)
      for (let i = 1; i < hDivisions; i++) {
        const basePosition = (canvasHeight * i) / hDivisions;
        if (gridMargin > 0) {
          horizontal.push(
            { position: basePosition - halfMargin, type: 'grid' },
            { position: basePosition + halfMargin, type: 'grid' }
          );
        } else {
          horizontal.push({ position: basePosition, type: 'grid' });
        }
      }
    } else {
      // Vertical grid lines
      for (let i = 1; i < vDivisions; i++) {
        const basePosition = (canvasWidth * i) / vDivisions;
        if (gridMargin > 0) {
          vertical.push(
            { position: basePosition - halfMargin, type: 'grid' },
            { position: basePosition + halfMargin, type: 'grid' }
          );
        } else {
          vertical.push({ position: basePosition, type: 'grid' });
        }
      }
      // Horizontal grid lines
      for (let i = 1; i < hDivisions; i++) {
        const basePosition = (canvasHeight * i) / hDivisions;
        if (gridMargin > 0) {
          horizontal.push(
            { position: basePosition - halfMargin, type: 'grid' },
            { position: basePosition + halfMargin, type: 'grid' }
          );
        } else {
          horizontal.push({ position: basePosition, type: 'grid' });
        }
      }
    }
  }

  // Other elements' edges and centers
  if (settings.elements) {
    for (const element of elements) {
      if (element.id === currentElementId) continue;

      // Vertical lines (left, center, right edges of other elements)
      vertical.push(
        { position: element.x, type: 'edge' },
        { position: element.x + element.width / 2, type: 'center' },
        { position: element.x + element.width, type: 'edge' }
      );

      // Horizontal lines (top, center, bottom edges of other elements)
      horizontal.push(
        { position: element.y, type: 'edge' },
        { position: element.y + element.height / 2, type: 'center' },
        { position: element.y + element.height, type: 'edge' }
      );
    }
  }

  return { vertical, horizontal };
}

/**
 * Find the closest snap position for dragging (position snapping)
 */
export function findSnap(
  rect: { x: number; y: number; width: number; height: number },
  snapLines: SnapLines,
  threshold: number = SNAP_THRESHOLD
): SnapResult {
  const guides: Guide[] = [];
  let snapX = rect.x;
  let snapY = rect.y;

  // Element edges and center
  const leftEdge = rect.x;
  const centerX = rect.x + rect.width / 2;
  const rightEdge = rect.x + rect.width;
  const topEdge = rect.y;
  const centerY = rect.y + rect.height / 2;
  const bottomEdge = rect.y + rect.height;

  // Find closest vertical snap (x-axis)
  let closestVerticalDist = threshold + 1;
  let closestVerticalLine: number | null = null;
  let verticalSnapOffset = 0;

  for (const line of snapLines.vertical) {
    // Check left edge
    const leftDist = Math.abs(leftEdge - line.position);
    if (leftDist < closestVerticalDist) {
      closestVerticalDist = leftDist;
      closestVerticalLine = line.position;
      verticalSnapOffset = line.position - leftEdge;
    }

    // Check center
    const centerDist = Math.abs(centerX - line.position);
    if (centerDist < closestVerticalDist) {
      closestVerticalDist = centerDist;
      closestVerticalLine = line.position;
      verticalSnapOffset = line.position - centerX;
    }

    // Check right edge
    const rightDist = Math.abs(rightEdge - line.position);
    if (rightDist < closestVerticalDist) {
      closestVerticalDist = rightDist;
      closestVerticalLine = line.position;
      verticalSnapOffset = line.position - rightEdge;
    }
  }

  if (closestVerticalLine !== null && closestVerticalDist <= threshold) {
    snapX = rect.x + verticalSnapOffset;
    guides.push({ orientation: 'vertical', position: closestVerticalLine });
  }

  // Find closest horizontal snap (y-axis)
  let closestHorizontalDist = threshold + 1;
  let closestHorizontalLine: number | null = null;
  let horizontalSnapOffset = 0;

  for (const line of snapLines.horizontal) {
    // Check top edge
    const topDist = Math.abs(topEdge - line.position);
    if (topDist < closestHorizontalDist) {
      closestHorizontalDist = topDist;
      closestHorizontalLine = line.position;
      horizontalSnapOffset = line.position - topEdge;
    }

    // Check center
    const centerDist = Math.abs(centerY - line.position);
    if (centerDist < closestHorizontalDist) {
      closestHorizontalDist = centerDist;
      closestHorizontalLine = line.position;
      horizontalSnapOffset = line.position - centerY;
    }

    // Check bottom edge
    const bottomDist = Math.abs(bottomEdge - line.position);
    if (bottomDist < closestHorizontalDist) {
      closestHorizontalDist = bottomDist;
      closestHorizontalLine = line.position;
      horizontalSnapOffset = line.position - bottomEdge;
    }
  }

  if (closestHorizontalLine !== null && closestHorizontalDist <= threshold) {
    snapY = rect.y + horizontalSnapOffset;
    guides.push({ orientation: 'horizontal', position: closestHorizontalLine });
  }

  return { x: snapX, y: snapY, guides };
}

/**
 * Determine which edges are being transformed based on anchor name
 */
function getTransformEdges(anchorName: string): {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
} {
  return {
    left: anchorName.includes('left'),
    right: anchorName.includes('right'),
    top: anchorName.includes('top'),
    bottom: anchorName.includes('bottom'),
  };
}

/**
 * Find snap positions during transform (resize)
 * Returns adjusted dimensions and position based on edge snapping
 */
export function findTransformSnap(
  rect: { x: number; y: number; width: number; height: number },
  anchorName: string,
  snapLines: SnapLines,
  threshold: number = SNAP_THRESHOLD
): TransformSnapResult {
  const guides: Guide[] = [];
  let { x, y, width, height } = rect;

  const edges = getTransformEdges(anchorName);

  // Calculate current edges
  const leftEdge = x;
  const rightEdge = x + width;
  const topEdge = y;
  const bottomEdge = y + height;

  // Snap left edge
  if (edges.left) {
    let closestDist = threshold + 1;
    let snapTo: number | null = null;

    for (const line of snapLines.vertical) {
      const dist = Math.abs(leftEdge - line.position);
      if (dist < closestDist) {
        closestDist = dist;
        snapTo = line.position;
      }
    }

    if (snapTo !== null && closestDist <= threshold) {
      const diff = snapTo - leftEdge;
      x += diff;
      width -= diff;
      guides.push({ orientation: 'vertical', position: snapTo });
    }
  }

  // Snap right edge
  if (edges.right) {
    let closestDist = threshold + 1;
    let snapTo: number | null = null;

    for (const line of snapLines.vertical) {
      const dist = Math.abs(rightEdge - line.position);
      if (dist < closestDist) {
        closestDist = dist;
        snapTo = line.position;
      }
    }

    if (snapTo !== null && closestDist <= threshold) {
      const diff = snapTo - rightEdge;
      width += diff;
      guides.push({ orientation: 'vertical', position: snapTo });
    }
  }

  // Snap top edge
  if (edges.top) {
    let closestDist = threshold + 1;
    let snapTo: number | null = null;

    for (const line of snapLines.horizontal) {
      const dist = Math.abs(topEdge - line.position);
      if (dist < closestDist) {
        closestDist = dist;
        snapTo = line.position;
      }
    }

    if (snapTo !== null && closestDist <= threshold) {
      const diff = snapTo - topEdge;
      y += diff;
      height -= diff;
      guides.push({ orientation: 'horizontal', position: snapTo });
    }
  }

  // Snap bottom edge
  if (edges.bottom) {
    let closestDist = threshold + 1;
    let snapTo: number | null = null;

    for (const line of snapLines.horizontal) {
      const dist = Math.abs(bottomEdge - line.position);
      if (dist < closestDist) {
        closestDist = dist;
        snapTo = line.position;
      }
    }

    if (snapTo !== null && closestDist <= threshold) {
      const diff = snapTo - bottomEdge;
      height += diff;
      guides.push({ orientation: 'horizontal', position: snapTo });
    }
  }

  return { x, y, width, height, guides };
}

/**
 * Generate static guide lines for visualization on canvas
 */
export function generateStaticGuides(
  settings: SnapSettings,
  canvasHeight: number,
  slideWidth: number,
  numSlides: number
): StaticGuide[] {
  const guides: StaticGuide[] = [];

  // Canvas center guides
  if (settings.canvas.show) {
    for (let i = 0; i < numSlides; i++) {
      const slideCenter = i * slideWidth + slideWidth / 2;
      guides.push({
        orientation: 'vertical',
        position: slideCenter,
        type: 'canvas',
      });
    }
    // Horizontal center
    guides.push({
      orientation: 'horizontal',
      position: canvasHeight / 2,
      type: 'canvas',
    });
  }

  // Margin guides
  if (settings.margin.show && settings.margin.value > 0) {
    const margin = settings.margin.value;
    for (let i = 0; i < numSlides; i++) {
      const slideLeft = i * slideWidth;
      guides.push(
        { orientation: 'vertical', position: slideLeft + margin, type: 'margin' },
        { orientation: 'vertical', position: slideLeft + slideWidth - margin, type: 'margin' }
      );
    }
    guides.push(
      { orientation: 'horizontal', position: margin, type: 'margin' },
      { orientation: 'horizontal', position: canvasHeight - margin, type: 'margin' }
    );
  }

  // Grid guides
  if (settings.grid.show) {
    const hDivisions = settings.grid.horizontal;
    const vDivisions = settings.grid.vertical;
    const gridMargin = settings.grid.margin;
    const halfMargin = gridMargin / 2;

    for (let slideIdx = 0; slideIdx < numSlides; slideIdx++) {
      const slideLeft = slideIdx * slideWidth;
      // Vertical grid lines within each slide
      for (let i = 1; i < vDivisions; i++) {
        const basePosition = slideLeft + (slideWidth * i) / vDivisions;
        if (gridMargin > 0) {
          guides.push(
            { orientation: 'vertical', position: basePosition - halfMargin, type: 'grid' },
            { orientation: 'vertical', position: basePosition + halfMargin, type: 'grid' }
          );
        } else {
          guides.push({ orientation: 'vertical', position: basePosition, type: 'grid' });
        }
      }
    }
    // Horizontal grid lines
    for (let i = 1; i < hDivisions; i++) {
      const basePosition = (canvasHeight * i) / hDivisions;
      if (gridMargin > 0) {
        guides.push(
          { orientation: 'horizontal', position: basePosition - halfMargin, type: 'grid' },
          { orientation: 'horizontal', position: basePosition + halfMargin, type: 'grid' }
        );
      } else {
        guides.push({ orientation: 'horizontal', position: basePosition, type: 'grid' });
      }
    }
  }

  return guides;
}
