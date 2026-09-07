import Phaser from 'phaser'
import { bulbCells, type InventionState } from '../inventions.ts'
import type { Simulation } from '../replay/simulation.ts'

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
        for (const cell of bulbCells()) bulb.fillStyle(cell.color, 1).fillRect(cell.x * 2, cell.y * 2, cell.width * 2, cell.height * 2)
        const name = this.scene.add.text(0, 0, moment.name, { fontFamily: 'system-ui, sans-serif', fontSize: '12px',
          color: '#382b18', backgroundColor: '#fff1aa', padding: { x: 4, y: 2 } }).setOrigin(0, 0.5).setDepth(205)
        view = Object.freeze({ bulb, name }); this.views.set(moment.changeId, view)
      }
      view.bulb.setPosition((resident?.x ?? 0) - 9, (resident?.y ?? 0) - 58).setVisible(visible)
      view.name.setPosition((resident?.x ?? 0) + 13, (resident?.y ?? 0) - 47)
        .setScale(Math.min(3, Math.max(1, 0.7 / zoom))).setVisible(visible)
    }
  }

  clear(): void {
    for (const view of this.views.values()) { view.bulb.destroy(); view.name.destroy() }
    this.views.clear()
  }
}
