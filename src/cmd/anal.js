import { audio } from '../audio.js';
import { events } from '../events.js';
import { escapeTerminalHtml, renderTerminalAppHtml, sampleTerminalSpectrumBands } from './app-helpers.js';

const WATERFALL_CHARSET = ' .:-=+*#%@';

function buildWaterfallFrame(state, options = {}) {
  const colorized = Boolean(options.colorized);
  const width = 48;
  const depth = 12;
  const levels = sampleTerminalSpectrumBands(width);
  const row = levels.map((level) => WATERFALL_CHARSET[Math.min(WATERFALL_CHARSET.length - 1, Math.floor(level * (WATERFALL_CHARSET.length - 1)))]);

  state.rows ??= [];
  state.rows.push({ chars: row, levels: [...levels] });
  if (state.rows.length > depth) {
    state.rows.shift();
  }

  const rows = Array.from({ length: depth }, (_, index) => state.rows[index] ?? {
    chars: Array.from({ length: width }, () => ' '),
    levels: Array.from({ length: width }, () => 0),
  });
  const plainLines = [
    'FREESIDE ANAL // WATERFALL SCAN',
    `SOURCE ${audio.isPlaying ? 'LIVE' : 'IDLE'}  SWEEP ${Math.round(events.state.sweep * 100).toString().padStart(3, '0')}  FRINGE ${Math.round(events.state.fringe * 100).toString().padStart(3, '0')}`,
    '',
    ...rows.map((entry) => ` |${entry.chars.join('')}|`),
    ' L ---------------------------------------------- H',
    '',
    ' PRESS ANY KEY TO EXIT ',
  ];

  if (!colorized) {
    return plainLines.join('\n');
  }

  const rowMarkup = rows.map((entry, rowIndex) => {
    const ageFactor = rowIndex / Math.max(1, depth - 1);
    const chars = entry.chars.map((char, index) => {
      const level = entry.levels[index] ?? 0;
      if (char === ' ') return ' ';

      const hue = Math.round(210 + (index / Math.max(1, width - 1)) * 110 - events.state.fringe * 30 + events.state.sweep * 20) % 360;
      const saturation = Math.round(72 + level * 18);
      const lightness = Math.round(30 + level * 28 + (1 - ageFactor) * 14);
      return `<span style="color:hsl(${hue} ${saturation}% ${lightness}%)">${escapeTerminalHtml(char)}</span>`;
    }).join('');

    return ` |${chars}|`;
  });

  return {
    html: renderTerminalAppHtml([
      ...plainLines.slice(0, 3).map(escapeTerminalHtml),
      ...rowMarkup,
      escapeTerminalHtml(plainLines[plainLines.length - 3]),
      escapeTerminalHtml(plainLines[plainLines.length - 2]),
      escapeTerminalHtml(plainLines[plainLines.length - 1]),
    ]),
  };
}

export default {
  name: './anal',
  aliases: ['analyzer', 'analyser'],
  run({ terminal, parsed }) {
    const colorized = !parsed.flags.has('--no-color');

    terminal.startAppMode({
      name: './anal',
      title: 'FREESIDE ANAL',
      frameInterval: 1 / 20,
      state: { rows: [] },
      renderFrame: ({ state }) => buildWaterfallFrame(state, { colorized }),
      onExit: () => ['Exited anal.', ''],
    });
    return null;
  },
};
