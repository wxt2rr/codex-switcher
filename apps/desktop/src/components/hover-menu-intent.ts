export interface HoverPoint { x: number; y: number }
export interface HoverRect { left: number; right: number; top: number; bottom: number }

function contains(point: HoverPoint, rect: HoverRect, tolerance: number) {
  return point.x >= rect.left - tolerance
    && point.x <= rect.right + tolerance
    && point.y >= rect.top - tolerance
    && point.y <= rect.bottom + tolerance;
}

export function isPointInsideHoverMenu(
  point: HoverPoint,
  trigger: HoverRect | null,
  content: HoverRect | null,
  tolerance = 4,
) {
  return Boolean((trigger && contains(point, trigger, tolerance)) || (content && contains(point, content, tolerance)));
}
