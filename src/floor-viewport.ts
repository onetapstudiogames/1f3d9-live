export type FloorRect = Readonly<{ x: number; y: number; width: number; height: number }>
type FloorCanvas = Readonly<{ scrollX: number; scrollY: number; width: number; height: number; zoom: number }>

export function floorViewport(floor: FloorRect, camera: FloorCanvas, tileSize = 32, origin = { x: floor.x - 4, y: floor.y - 4 }) {
  if (![floor.x, floor.y, floor.width, floor.height, camera.scrollX, camera.scrollY, camera.width, camera.height, camera.zoom, tileSize, origin.x, origin.y].every(Number.isFinite)
    || tileSize <= 0
    || camera.zoom <= 0 || camera.width <= 0 || camera.height <= 0 || floor.width <= 0 || floor.height <= 0) return null
  const widthInRoom = camera.width / camera.zoom
  const heightInRoom = camera.height / camera.zoom
  const view = { x: camera.scrollX + (camera.width - widthInRoom) / 2,
    y: camera.scrollY + (camera.height - heightInRoom) / 2, width: widthInRoom, height: heightInRoom }
  if (floor.x >= view.x + view.width || floor.y >= view.y + view.height
    || floor.x + floor.width <= view.x || floor.y + floor.height <= view.y) return null
  const pixelWidth = Math.ceil(Math.min(camera.width, floor.width * camera.zoom))
  const pixelHeight = Math.ceil(Math.min(camera.height, floor.height * camera.zoom))
  const width = pixelWidth / camera.zoom; const height = pixelHeight / camera.zoom
  const x = floor.width <= view.width ? floor.x : view.x
  const y = floor.height <= view.height ? floor.y : view.y
  const cropX = Math.max(0, (floor.x - x) * camera.zoom)
  const cropY = Math.max(0, (floor.y - y) * camera.zoom)
  const cropWidth = Math.min(pixelWidth, (floor.x + floor.width - x) * camera.zoom) - cropX
  const cropHeight = Math.min(pixelHeight, (floor.y + floor.height - y) * camera.zoom) - cropY
  const mod = (value: number): number => ((value % tileSize) + tileSize) % tileSize
  return Object.freeze({ x, y, width, height, pixelWidth, pixelHeight, cropX, cropY, cropWidth, cropHeight,
    tileX: mod(x - origin.x), tileY: mod(y - origin.y), scale: camera.zoom })
}
