import type { Point } from './ground/nested.ts'

// Screen-space names keep their reading size; crowded names yield to figures and other labels.
export function clearThingLabels(labels: readonly (Point & { id: number })[], figures: readonly Point[]): ReadonlySet<number> {
  const placed: Point[] = []
  return new Set([...labels].sort((a, b) => a.id - b.id).flatMap(label => {
    if (figures.some(figure => Math.abs(figure.x - label.x) < 80 && figure.y > label.y - 38 && figure.y < label.y + 56)
      || placed.some(other => Math.abs(other.x - label.x) < 124 && Math.abs(other.y - label.y) < 40)) return []
    placed.push(label)
    return [label.id]
  }))
}
