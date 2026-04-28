import * as THREE from 'three';
import { startTerminalApp } from './app-helpers.js';

export default {
  name: './freecam',
  run({ scene, terminal, parsed }) {
    if (parsed.args.length > 0) {
      return 'Usage: ./freecam';
    }

    if (scene.freecam.active) {
      scene.disableFreecam();
      return 'Freecam disengaged.';
    }

    const result = startTerminalApp(terminal, {
      name: 'freecam',
      title: 'FREESIDE FREECAM',
      frameInterval: 1 / 24,
      exitOnAnyKey: false,
      renderFrame: () => ({
        text: [
          'FREESIDE FREECAM // ACTIVE',
          '',
          'MOUSE   adjust view',
          'W/A/S/D translate',
          'SHIFT   boost',
          'ESC     exit freecam',
          '',
          `POS X ${scene.freecam.position.x.toFixed(2).padStart(7, ' ')}  Y ${scene.freecam.position.y.toFixed(2).padStart(7, ' ')}  Z ${scene.freecam.position.z.toFixed(2).padStart(7, ' ')}`,
          `YAW   ${THREE.MathUtils.radToDeg(scene.freecam.yaw).toFixed(1).padStart(7, ' ')}`,
          `PITCH ${THREE.MathUtils.radToDeg(scene.freecam.pitch).toFixed(1).padStart(7, ' ')}`,
          '',
          'PRESS ESC TO RETURN TO THE SHELL',
        ].join('\n'),
      }),
      exitMessage: 'Exited ./freecam.',
    });
    scene.enableFreecam(terminal);
    return result;
  },
};
