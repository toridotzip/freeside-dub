import analCommand from './anal.js';
import chshCommand from './chsh.js';
import clearCommand from './clear.js';
import cmatrixCommand from './cmatrix.js';
import echoCommand from './echo.js';
import eqCommand from './eq.js';
import exitCommand from './exit.js';
import fxCommand from './fx.js';
import freecamCommand from './freecam.js';
import helpCommand from './help.js';
import lsCommand from './ls.js';
import { parseCommandInput } from './parse.js';
import shCommand from './sh.js';

const COMMAND_DEFINITIONS = [
  clearCommand,
  exitCommand,
  shCommand,
  lsCommand,
  echoCommand,
  eqCommand,
  analCommand,
  cmatrixCommand,
  fxCommand,
  freecamCommand,
  helpCommand,
  chshCommand,
];

const COMMANDS_BY_NAME = new Map();

COMMAND_DEFINITIONS.forEach((definition) => {
  [definition.name, ...(definition.aliases ?? [])].forEach((alias) => {
    COMMANDS_BY_NAME.set(alias, definition);
  });
});

export const COMMAND_TERMINAL_COMMANDS = COMMAND_DEFINITIONS.map(({ name }) => name);

export function getCommandCompletions(prefix = '') {
  const normalized = String(prefix ?? '').toLowerCase();
  return COMMAND_TERMINAL_COMMANDS.filter((command) => command.startsWith(normalized));
}

export function runTerminalCommand({ scene, terminal, command }) {
  const parsed = parseCommandInput(command);
  const definition = COMMANDS_BY_NAME.get(parsed.name);

  if (!definition) {
    return [
      `Unknown command: ${command}`,
      'type `help` for help',
    ];
  }

  return definition.run({
    scene,
    terminal,
    command,
    parsed,
  });
}
