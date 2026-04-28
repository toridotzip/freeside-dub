import { audio } from '../audio.js';
import { events } from '../events.js';
import { escapeTerminalHtml, renderTerminalAppHtml, sampleTerminalSpectrumBands, startTerminalApp } from './app-helpers.js';

const WATERFALL_CHARSET = ' .:-=+*#%@';

function buildWaterfallFrame(state, options = {}) {
  const colorized = Boolean(options.colorized);
  const width = 60;
  const depth = 14;
  const levels = sampleTerminalSpectrumBands(width);
  const row = levels.map((level) => WATERFALL_CHARSET[Math.min(WATERFALL_CHARSET.length - 1, Math.floor(level * (WATERFALL_CHARSET.length - 1)))]);

  state.rows ??= [];
  state.rows.push({ chars: row, levels: [...levels] });
  while (state.rows.length > depth) {
    state.rows.shift();
  }

  const rows = Array.from({ length: depth }, (_, index) => state.rows[index] ?? {
    chars: Array.from({ length: width }, () => ' '),
    levels: Array.from({ length: width }, () => 0),
  });

  const rowLines = rows.map((entry, rowIndex) => {
    if (!colorized) {
      return ` |${entry.chars.join('')}|`;
    }

    const ageFactor = rowIndex / Math.max(1, depth - 1);
    const chars = entry.chars.map((char, index) => {
      const level = entry.levels[index] ?? 0;
      if (char === ' ') return ' ';

      const hue = Math.round(210 + (index / Math.max(1, width - 1)) * 110 - events.state.fringe * 30 + events.state.sweep * 20) % 360;
      const saturation = Math.round(60 + level * 20);
      const lightness = Math.round(30 + level * 32 + (1 - ageFactor) * 16);
      return `<span style="color:hsl(${hue} ${saturation}% ${lightness}%)">${escapeTerminalHtml(char)}</span>`;
    }).join('');

    return ` |${chars}|`;
  });

  const lines = [
    'FREESIDE ANAL // WATERFALL SCAN',
    `SOURCE ${audio.isPlaying ? 'LIVE' : 'IDLE'}  SWEEP ${Math.round(events.state.sweep * 100).toString().padStart(3, '0')}  FRINGE ${Math.round(events.state.fringe * 100).toString().padStart(3, '0')}`,
    'PRESS ANY KEY TO EXIT',
    ...rowLines,
    ' L ---------------------------------------------------------- H',
  ];

  if (!colorized) {
    return lines.join('\n');
  }

  return {
    html: renderTerminalAppHtml(lines),
  };
}

export default {
  name: './anal',
  aliases: ['analyzer', 'analyser'],
  run({ terminal, parsed }) {
    const colorized = !parsed.flags.has('--no-color');

    return startTerminalApp(terminal, {
      name: './anal',
      title: 'FREESIDE ANAL',
      frameInterval: 1 / 20,
      state: { rows: [] },
      renderFrame: ({ state }) => buildWaterfallFrame(state, { colorized }),
      exitMessage: 'nailed it.',
    });
  },
};
