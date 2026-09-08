const WALK_BOB_PIXELS = 2
const IDLE_PERIOD_MS = 1_800

export function residentBobOffset(residentId: number, now: number, walking: boolean): number {
  if (walking) return Math.sin(now / 90) * WALK_BOB_PIXELS
  const phase = (Math.abs(residentId) % 12) / 12 * Math.PI * 2
  return Math.sin(now / IDLE_PERIOD_MS * Math.PI * 2 + phase) * WALK_BOB_PIXELS
}
