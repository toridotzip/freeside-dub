import { normalizeTerminalOs } from '../terminal.js';

export function formatTerminalOsName(value) {
  const os = normalizeTerminalOs(value);

  if (os === 'MACOS') return 'macos';
  if (os === 'LINUX') return 'linux';
  return 'windows';
}

export function resolveTerminalOsArgument(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) return null;
  if (['windows', 'win', 'cmd', 'w'].includes(normalized)) return 'WINDOWS';
  if (['macos', 'mac', 'osx', 'darwin', 'm'].includes(normalized)) return 'MACOS';
  if (['linux', 'lin', 'bash', 'l'].includes(normalized)) return 'LINUX';

  return null;
}
