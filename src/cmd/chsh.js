import { formatTerminalOsName, resolveTerminalOsArgument } from './os.js';

export default {
  name: 'chsh',
  run({ terminal, parsed }) {
    const { args } = parsed;

    if (args.length === 0) {
      return `Current shell style: ${formatTerminalOsName(terminal.os)}`;
    }

    if (args.length > 1) {
      return 'Usage: chsh [windows|macos|linux|dub]';
    }

    const nextOs = resolveTerminalOsArgument(args[0]);
    if (!nextOs) {
      return `Unknown shell style: ${args[0]}\nAvailable styles: windows, macos, linux, dub`;
    }

    terminal.applyVariant(nextOs);
    return `Shell style changed to ${formatTerminalOsName(nextOs)}.`;
  },
};
