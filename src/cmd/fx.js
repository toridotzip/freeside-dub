import { escapeTerminalHtml, renderTerminalAppHtml, startTerminalApp } from './app-helpers.js';

function clampSelection(state, controls) {
  if (controls.length === 0) {
    state.selectedIndex = 0;
    return;
  }

  state.selectedIndex = Math.max(0, Math.min(controls.length - 1, state.selectedIndex || 0));
}

function buildFxFrame(scene, state) {
  const snapshot = scene.getAdaptiveRenderEditorSnapshot();
  clampSelection(state, snapshot.controls);

  const selectedControl = snapshot.controls[state.selectedIndex] ?? null;
  const lines = [
    ...snapshot.runtimeLines.map(escapeTerminalHtml),
    '',
    escapeTerminalHtml('UP/DOWN SELECT  LEFT/RIGHT EDIT  ENTER TOGGLE/STEP  ESC EXIT'),
    '',
  ];

  snapshot.controls.forEach((control, index) => {
    const isSelected = index === state.selectedIndex;
    const prefix = isSelected ? '&gt;' : '&nbsp;';
    const label = escapeTerminalHtml(control.label.padEnd(18, ' '));
    const value = escapeTerminalHtml(control.valueText.padStart(10, ' '));
    const row = `${prefix} ${label} ${value}`;

    if (isSelected) {
      lines.push(`<span style="color:hsl(191 100% 76%)">${row}</span>`);
      return;
    }

    lines.push(`<span style="color:hsl(193 38% 74%)">${row}</span>`);
  });

  lines.push('');
  if (selectedControl?.detail) {
    lines.push(`<span style="color:hsl(321 84% 77%)">${escapeTerminalHtml(selectedControl.detail)}</span>`);
  } else {
    lines.push(escapeTerminalHtml('Adaptive render tuning interface.'));
  }

  return {
    html: renderTerminalAppHtml(lines),
  };
}

function handleFxKeyDown(scene, state, event) {
  const controls = scene.getAdaptiveRenderEditorSnapshot().controls;
  clampSelection(state, controls);

  if (controls.length === 0) {
    return undefined;
  }

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      state.selectedIndex = (state.selectedIndex - 1 + controls.length) % controls.length;
      return false;
    case 'ArrowDown':
      event.preventDefault();
      state.selectedIndex = (state.selectedIndex + 1) % controls.length;
      return false;
    case 'ArrowLeft':
      event.preventDefault();
      scene.adjustAdaptiveRenderSetting(controls[state.selectedIndex].id, -1);
      return false;
    case 'ArrowRight':
    case 'Enter':
    case ' ':
      event.preventDefault();
      scene.adjustAdaptiveRenderSetting(controls[state.selectedIndex].id, 1);
      return false;
    default:
      return undefined;
  }
}

export default {
  name: './fx',
  run({ scene, terminal, parsed }) {
    if (parsed.args.length > 0) {
      return 'Usage: ./fx';
    }

    scene.beginAdaptiveRenderEditing();
    return startTerminalApp(terminal, {
      name: './fx',
      title: 'FREESIDE FX',
      frameInterval: 1 / 12,
      exitOnAnyKey: false,
      state: { selectedIndex: 0 },
      renderFrame: ({ state }) => buildFxFrame(scene, state),
      onKeyDown: ({ event, state }) => handleFxKeyDown(scene, state, event),
      onExit: () => {
        scene.endAdaptiveRenderEditing();
        return ['Exited ./fx.', ''];
      },
    });
  },
};
