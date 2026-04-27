const COMMAND_TOKEN_PATTERN = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;

function tokenizeCommandInput(input) {
  return Array.from(input.matchAll(COMMAND_TOKEN_PATTERN), (match) => {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    return token.replace(/\\(["'\\])/g, '$1');
  });
}

export function parseCommandInput(input) {
  const trimmed = input.trim();
  const tokens = tokenizeCommandInput(trimmed);
  const [name = '', ...args] = tokens;
  const rawArgs = trimmed.slice(name.length).trimStart();

  return {
    name: name.toLowerCase(),
    args,
    rawArgs,
    flags: new Set(args.filter((arg) => arg.startsWith('--'))),
  };
}
