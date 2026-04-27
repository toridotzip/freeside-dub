const PREFIX_COMMANDS = ['anal', 'cmatrix', 'eq', 'freecam'];

export default {
  name: 'ls',
  run() {
    return PREFIX_COMMANDS.join(" ");
  },
};
