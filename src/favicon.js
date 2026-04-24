const FAVICONS = [
  { title: 'Facebook', favicon: '/facebook.ico' },
  { title: 'Feed | LinkedIn', favicon: '/linkedin.ico' },
  { title: 'Myspace', favicon: '/myspace.ico' },
  { title: 'Hacker News', favicon: '/ycombinator.ico' },
  { title: 'Reddit - The heart of the internet', favicon: '/reddit.ico' },
];

const DEFAULT_CYCLE_MS = 10000;

export class FaviconCycler {
  constructor({ pairs = FAVICONS, cycleMs = DEFAULT_CYCLE_MS, linkId = 'favicon' } = {}) {
    this.pairs = pairs;
    this.cycleMs = cycleMs;
    this.linkId = linkId;
    this.index = Math.floor(Math.random() * pairs.length);
    this.timer = null;
  }

  start() {
    this.changeFavicon();
    this.timer = setInterval(() => this.changeFavicon(), this.cycleMs);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  changeFavicon() {
    const pair = this.pairs[this.index];
    document.title = pair.title;

    const oldLink = document.getElementById(this.linkId);
    const newLink = document.createElement('link');
    newLink.id = this.linkId;
    newLink.rel = 'icon';
    newLink.type = 'image/x-icon';
    newLink.href = pair.favicon + '?' + Date.now();
    oldLink.parentNode.replaceChild(newLink, oldLink);

    this.index = (this.index + 1) % this.pairs.length;
  }
}
