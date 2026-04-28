import { audio } from '../audio.js';
import { events } from '../events.js';
import { escapeTerminalHtml, renderTerminalAppHtml, sampleTerminalSpectrumBands, startTerminalApp } from './app-helpers.js';

const EQ_TERMINAL_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '6k', '8k', '12k', '16k'];

function buildEqMeterFrame(options = {}) {
  const colorized = Boolean(options.colorized);
  const levels = sampleTerminalSpectrumBands(EQ_TERMINAL_LABELS.length);
  const meterHeight = 12;
  const grid = [];
  const hueShift = events.state.sweep * 45 + events.state.shimmer * 35;

  for (let row = meterHeight; row >= 1; row -= 1) {
    const threshold = row / meterHeight;
    if (!colorized) {
      const cells = levels.map((level) => (level >= threshold ? '###' : '   '));
      grid.push(`  ${cells.join(' ')}`);
      continue;
    }

    const cells = levels.map((level, index) => {
      if (level < threshold) return '   ';

      const hue = Math.round((index / Math.max(1, EQ_TERMINAL_LABELS.length - 1)) * 220 + 20 + hueShift) % 360;
      const saturation = Math.round(78 + level * 16);
      const lightness = Math.round(46 + level * 18 + events.state.energy * 10);
      return `<span style="color:hsl(${hue} ${saturation}% ${lightness}%)">###</span>`;
    });

    grid.push(`  ${cells.join(' ')}`);
  }

  const low = Math.round((events.state.bands.bass + events.state.bands.lowmid) * 50);
  const mid = Math.round((events.state.bands.mid + events.state.bands.highmid) * 50);
  const high = Math.round(events.state.bands.high * 100);
  const plainLines = [
    'FREESIDE EQ-12 // LIVE BAR METER',
    `SOURCE ${audio.isPlaying ? 'LIVE' : 'IDLE'}  ENERGY ${Math.round(events.state.energy * 100).toString().padStart(3, '0')}  RMS ${Math.round(events.state.rms * 100).toString().padStart(3, '0')}`,
    '',
    ...grid,
    `  ${EQ_TERMINAL_LABELS.map((label) => label.padStart(3, ' ')).join(' ')}`,
    '',
    ` LOW ${String(low).padStart(3, '0')}  MID ${String(mid).padStart(3, '0')}  HIGH ${String(high).padStart(3, '0')}  PRESS ANY KEY TO EXIT`,
  ];

  if (!colorized) {
    return plainLines.join('\n');
  }

  return {
    html: renderTerminalAppHtml([
      ...plainLines.slice(0, 3).map(escapeTerminalHtml),
      ...grid,
      escapeTerminalHtml(plainLines[plainLines.length - 3]),
      escapeTerminalHtml(plainLines[plainLines.length - 2]),
      escapeTerminalHtml(plainLines[plainLines.length - 1]),
    ]),
  };
}

export default {
  name: './eq',
  run({ terminal, parsed }) {
    const colorized = !parsed.flags.has('--no-color');

    return startTerminalApp(terminal, {
      name: './eq',
      title: 'FREESIDE EQ-12',
      frameInterval: 1 / 20,
      renderFrame: () => buildEqMeterFrame({ colorized }),
      exitMessage: 'Exited ./eq.',
    });
  },
};
