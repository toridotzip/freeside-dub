import { events } from '../events.js';
import { escapeTerminalHtml, renderTerminalAppHtml } from './app-helpers.js';

const CMATRIX_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=-<>[]{}';

function randomMatrixGlyph() {
  return CMATRIX_CHARSET[Math.floor(Math.random() * CMATRIX_CHARSET.length)];
}

function resetMatrixColumn(column, height) {
  column.head = -Math.floor(Math.random() * height);
  column.length = 4 + Math.floor(Math.random() * 10);
  column.speed = 7 + Math.random() * 12;
}

function buildMatrixFrame(state) {
  const width = 63;
  const height = 16;
  const intensity = 0.85 + events.state.energy * 0.55 + events.state.shimmer * 0.22;

  if (!Array.isArray(state.columns) || state.columns.length !== width) {
    state.columns = Array.from({ length: width }, () => {
      const column = {};
      resetMatrixColumn(column, height);
      column.head -= Math.floor(Math.random() * height * 1.5);
      return column;
    });
  }

  const step = Math.max(0.012, state.dt || 0.016);
  state.columns.forEach((column) => {
    column.head += column.speed * step * intensity;
    if (column.head - column.length > height + 3) {
      resetMatrixColumn(column, height);
    }
  });

  const lines = [];
  lines.push(escapeTerminalHtml('FREESIDE CMATRIX // NEURAL RAIN'));
  lines.push(escapeTerminalHtml('PRESS ANY KEY TO EXIT'));

  for (let row = 0; row < height; row += 1) {
    const cells = state.columns.map((column) => {
      const distance = column.head - row;
      if (distance < 0 || distance > column.length) return ' ';

      const falloff = 1 - distance / Math.max(1, column.length);
      const glyph = escapeTerminalHtml(randomMatrixGlyph());
      if (distance < 0.85) {
        return `<span style="color:hsl(136 100% 92%)">${glyph}</span>`;
      }

      const lightness = Math.round(24 + falloff * 46 + events.state.energy * 12);
      const saturation = Math.round(78 + falloff * 18);
      return `<span style="color:hsl(134 ${saturation}% ${lightness}%)">${glyph}</span>`;
    }).join('');

    lines.push(cells);
  }

  return {
    html: renderTerminalAppHtml(lines),
  };
}

export default {
  name: './cmatrix',
  run({ terminal }) {
    terminal.startAppMode({
      name: './cmatrix',
      title: 'FREESIDE CMATRIX',
      frameInterval: 1 / 18,
      state: { columns: [], dt: 0.016 },
      renderFrame: ({ state, dt }) => {
        state.dt = dt;
        return buildMatrixFrame(state);
      },
      onExit: () => ['Exited ./cmatrix.', ''],
    });
    return null;
  },
};
