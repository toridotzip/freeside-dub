export default {
  name: 'sh',
  run({ scene, terminal }) {
    const shell = scene.createCommandTerminal({
      os: terminal.os,
      baseOffsetX: terminal.baseOffsetX + terminal.manualOffsetX + 34,
      baseOffsetY: terminal.baseOffsetY + terminal.manualOffsetY + 28,
    });
    shell.open();
    scene.bringTerminalToFront(shell);
    return 'popped another one.';
  },
};
