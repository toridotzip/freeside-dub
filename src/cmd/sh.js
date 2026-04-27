export default {
  name: 'sh',
  run({ scene, terminal }) {
    const shell = scene.createCommandTerminal({
      baseOffsetX: terminal.baseOffsetX + terminal.manualOffsetX + 34,
      baseOffsetY: terminal.baseOffsetY + terminal.manualOffsetY + 28,
    });
    shell.applyVariant(scene.defaultBootTerminalOs);
    shell.open();
    scene.bringTerminalToFront(shell);
    return 'popped another one.';
  },
};
