import Phaser from 'phaser'
import type { InventionState } from '../inventions.ts'
import type { Simulation } from '../replay/simulation.ts'
import { roomTextResolution } from '../room-appearance.ts'
import { RESIDENT_BULB_RECTS, residentBulbAnchor, residentOverlayDistance } from '../resident-overlays.ts'

type InventionView = Readonly<{ bulb: Phaser.GameObjects.Graphics; name: Phaser.GameObjects.Text }>

export class InventionLayer {
  private readonly views = new Map<string, InventionView>()

  constructor(private readonly scene: Phaser.Scene) {}

  update(state: InventionState, residents: Simulation, hiddenPlaces: ReadonlySet<number>, zoom: number): void {
    const active = new Set(state.moments.map(moment => moment.changeId))
    for (const [id, view] of this.views) if (!active.has(id)) {
      view.bulb.destroy(); view.name.destroy(); this.views.delete(id)
    }
    for (const moment of state.moments) {
      const resident = residents.residents[moment.residentId]
      const visible = Boolean(resident?.visible && resident.placeId !== null && !hiddenPlaces.has(resident.placeId))
      let view = this.views.get(moment.changeId)
      if (!view) {
        const bulb = this.scene.add.graphics().setDepth(205)
        for (const cell of RESIDENT_BULB_RECTS) bulb.fillStyle(cell.color, cell.alpha)
          .fillRect(cell.x, cell.y, cell.width, cell.height)
        const name = this.scene.add.text(0, 0, moment.name, { fontFamily: 'system-ui, sans-serif', fontSize: '12px',
          color: '#382b18', backgroundColor: '#fff1aa', padding: { x: 4, y: 2 },
          resolution: roomTextResolution(window.devicePixelRatio) }).setOrigin(0, 0.5).setDepth(205)
        name.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
        view = Object.freeze({ bulb, name }); this.views.set(moment.changeId, view)
      }
      const resolution = roomTextResolution(window.devicePixelRatio)
      if (view.name.style.resolution !== resolution) view.name.setResolution(resolution)
      const bulbAnchor = residentBulbAnchor(resident ?? { x: 0, y: 0 })
      view.bulb.setPosition(bulbAnchor.x, bulbAnchor.y).setVisible(visible)
      view.name.setPosition((resident?.x ?? 0) + residentOverlayDistance(13),
        (resident?.y ?? 0) + residentOverlayDistance(-47))
        .setScale(Math.min(3, Math.max(1, 0.7 / zoom))).setVisible(visible)
    }
  }

  clear(): void {
    for (const view of this.views.values()) { view.bulb.destroy(); view.name.destroy() }
    this.views.clear()
  }
}
