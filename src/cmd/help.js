export default {
  name: 'help',
  run() {
    return [
      'Available commands:',
      'clear           - clear the terminal output',
      'exit            - close this terminal window',
      'echo <text>     - repeat text back to the terminal',
      'chsh [style]    - show or change shell style',
      'ls              - list files',
      'sh              - open another shell window',
    ];
  },
};
