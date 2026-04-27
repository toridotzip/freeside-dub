export default {
  name: 'echo',
  run({ parsed }) {
    return parsed.rawArgs;
  },
};
