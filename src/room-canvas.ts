export type RoomCanvasSizing = Readonly<{
  width: number; height: number; backingWidth: number; backingHeight: number
  zoom: number; scrollX: number; scrollY: number
}>

// Layout uses CSS pixels. Only the renderer and camera use device pixels.
export function roomCanvasSizing(width: number, height: number, devicePixelRatio: number): RoomCanvasSizing {
  width = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0
  height = Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0
  const zoom = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const backingWidth = Math.max(1, Math.round(width * zoom))
  const backingHeight = Math.max(1, Math.round(height * zoom))
  // Phaser zooms about the viewport centre, rounding that matrix origin.
  const scrollX = Math.round(backingWidth / 2) / zoom - backingWidth / 2
  const scrollY = Math.round(backingHeight / 2) / zoom - backingHeight / 2
  return Object.freeze({ width, height, backingWidth, backingHeight, zoom, scrollX, scrollY })
}
