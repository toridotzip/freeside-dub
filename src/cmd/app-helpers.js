import * as THREE from 'three';
import { audio } from '../audio.js';

export function escapeTerminalHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderTerminalAppHtml(lines) {
  return lines.map((line) => `<div class="system-terminal__app-line">${line}</div>`).join('');
}

export function startTerminalApp(terminal, options = {}) {
  const {
    exitMessage = null,
    ...appOptions
  } = options;

  terminal.startAppMode({
    ...appOptions,
    ...(!appOptions.onExit && exitMessage
      ? { onExit: () => [exitMessage, ''] }
      : {}),
  });

  return null;
}

export function sampleTerminalSpectrumBands(count, minFreq = 32, maxFreq = 16000) {
  const spectrum = audio.dataArray;
  const length = spectrum?.length ?? 0;

  if (!length || count <= 0) {
    return Array.from({ length: Math.max(0, count) }, () => 0);
  }

  const nyquist = (audio.ctx?.sampleRate || 44100) * 0.5;
  const safeMinFreq = Math.max(20, minFreq);
  const safeMaxFreq = Math.min(maxFreq, nyquist);
  const ratio = safeMaxFreq / safeMinFreq;

  return Array.from({ length: count }, (_, index) => {
    const startFreq = safeMinFreq * Math.pow(ratio, index / count);
    const endFreq = safeMinFreq * Math.pow(ratio, (index + 1) / count);
    const startIdx = Math.max(0, Math.floor((startFreq / nyquist) * length));
    const endIdx = Math.min(length, Math.max(startIdx + 1, Math.ceil((endFreq / nyquist) * length)));

    let sum = 0;
    for (let i = startIdx; i < endIdx; i += 1) {
      sum += spectrum[i];
    }

    const average = sum / Math.max(1, endIdx - startIdx);
    return Math.pow(THREE.MathUtils.clamp(average / 255, 0, 1), 0.85);
  });
}
