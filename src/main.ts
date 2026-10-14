import Phaser from 'phaser'
import { CityScene } from './scenes/CityScene.ts'
import { roomCanvasSizing } from './room-canvas.ts'
import { startSeason } from './season-view.ts'

const app = document.getElementById('app')!
const frame = roomCanvasSizing(app.clientWidth, app.clientHeight, window.devicePixelRatio)

// One page, one scene. Everything drawn here comes from the city's public record.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0f1a17',
  // Text is filtered smoothly; each 8×8 art texture selects NEAREST itself.
  antialias: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.NONE, width: frame.backingWidth, height: frame.backingHeight, zoom: 1 / frame.zoom },
  scene: [CityScene],
})

// The city's season dresses the frame only; it never delays or changes the room picture.
startSeason()
