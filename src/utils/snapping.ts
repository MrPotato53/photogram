import type { Element, Guide } from '../types';

interface SnapLine {
  position: number;
  type: 'edge' | 'center';
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

const SNAP_THRESHOLD = 8; // pixels

/**
 * Calculate all snap lines from canvas boundaries and other elements
 */
export function calculateSnapLines(
  elements: Element[],
  currentElementId: string,
  canvasWidth: number,
  canvasHeight: number
): SnapLines {
  const vertical: SnapLine[] = [];
  const horizontal: SnapLine[] = [];

  // Canvas edges and center
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

  // Other elements' edges and centers
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

  return { vertical, horizontal };
}

/**
 * Find the closest snap position and return snapped coordinates + active guides
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
