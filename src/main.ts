import Phaser from 'phaser'
import { CityScene } from './scenes/CityScene.ts'

// One page, one scene. Everything drawn here comes from the city's public record.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0f1a17',
  // Text is filtered smoothly; each 8×8 art texture selects NEAREST itself.
  antialias: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [CityScene],
})
