const TERMINAL_CURSOR_GLYPHS = {
  WINDOWS: '_',
  MACOS: '█',
  LINUX: '█',
};

const TERMINAL_PROMPTS = {
  WINDOWS: 'C:\\Windows\\freeside>',
  MACOS: 'root@localhost /Volumes/Freeside % ',
  LINUX: 'root@localhost /opt/freeside# ',
};

export const TERMINAL_VARIANTS = {
  WINDOWS: {
    frameSrc: '/cmd_empty.png',
    imageWidth: 1200,
    imageHeight: 720,
    offsetX: 4,
    offsetY: 60,
    insetRight: 20,
    insetBottom: 2,
    fontFamily: "Consolas, 'Lucida Console', 'Courier New', monospace",
    textColor: '#c9c9c9',
    fontSize: 'clamp(11px, 1.05vw, 17px)',
    lineHeight: '1.2',
  },
  MACOS: {
    frameSrc: '/macterm_empty.png',
    imageWidth: 1364,
    imageHeight: 966,
    offsetX: 115,
    offsetY: 135,
    insetRight: 95,
    insetBottom: 150,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    textColor: '#f6f6f6',
    fontSize: 'clamp(11px, 0.98vw, 16px)',
    lineHeight: '1.28',
  },
  LINUX: {
    frameSrc: '/linuxterm_empty.png',
    imageWidth: 1200,
    imageHeight: 863,
    offsetX: 15,
    offsetY: 80,
    insetRight: 18,
    insetBottom: 20,
    fontFamily: "'Ubuntu Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace",
    textColor: '#dddddd',
    fontSize: 'clamp(11px, 1vw, 16px)',
    lineHeight: '1.24',
  },
};

export function normalizeTerminalOs(value) {
  const normalized = String(value || '').toUpperCase();

  if (normalized === 'MACOS') return 'MACOS';
  if (normalized === 'LINUX') return 'LINUX';

  return 'WINDOWS';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function toScriptActions(parts) {
  const actions = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      const lines = part.replace(/\r/g, '').split('\n');
      lines.forEach((line) => {
        actions.push({ type: 'line', text: line });
      });
      continue;
    }

    if (part && typeof part === 'object') {
      if (typeof part.pause === 'number') {
        actions.push({ type: 'pause', duration: Math.max(0, part.pause) });
        continue;
      }

      if (part.type === 'line') {
        actions.push({
          type: 'line',
          text: String(part.text ?? ''),
          delay: typeof part.delay === 'number' ? Math.max(0, part.delay) : undefined,
        });
      }
    }
  }

  return actions;
}

export class TerminalWindow {
  constructor(container, options = {}) {
    this.container = container;
    this.id = options.id || `terminal-${Math.random().toString(36).slice(2)}`;
    this.os = normalizeTerminalOs(options.os);
    this.draggable = Boolean(options.draggable);
    this.interactive = Boolean(options.interactive);
    this.showCursor = Boolean(options.showCursor);
    this.wobbleScale = Number.isFinite(options.wobbleScale) ? options.wobbleScale : 1;
    this.baseOffsetX = Number.isFinite(options.baseOffsetX) ? options.baseOffsetX : 0;
    this.baseOffsetY = Number.isFinite(options.baseOffsetY) ? options.baseOffsetY : 0;
    this.manualOffsetX = 0;
    this.manualOffsetY = 0;
    this.fleeOffsetX = 0;
    this.fleeOffsetY = 0;
    this.visible = false;
    this.closing = false;
    this.destroyed = false;
    this.scriptToken = 0;
    this.timers = [];
    this.focusFrameId = 0;
    this.dragState = null;
    this.onFocus = typeof options.onFocus === 'function' ? options.onFocus : null;
    this.onDestroy = typeof options.onDestroy === 'function' ? options.onDestroy : null;
    this.onCommand = typeof options.onCommand === 'function' ? options.onCommand : null;
    this.getCompletions = typeof options.getCompletions === 'function' ? options.getCompletions : null;
    this.promptText = options.promptText || TERMINAL_PROMPTS[this.os];
    this.appMode = null;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.historyDraft = '';
    this.suppressInputTracking = false;

    this.root = document.createElement('div');
    this.root.className = 'system-terminal hidden';
    this.root.dataset.terminalId = this.id;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.tabIndex = -1;

    this.frame = document.createElement('img');
    this.frame.className = 'system-terminal__frame';
    this.frame.alt = '';
    this.frame.draggable = false;

    this.viewport = document.createElement('div');
    this.viewport.className = 'system-terminal__viewport';

    this.scroller = document.createElement('div');
    this.scroller.className = 'system-terminal__scroller';

    this.output = document.createElement('div');
    this.output.className = 'system-terminal__output';

    this.appScreen = document.createElement('div');
    this.appScreen.className = 'system-terminal__app';
    this.appScreen.setAttribute('aria-hidden', 'true');

    this.scroller.append(this.output, this.appScreen);
    this.viewport.append(this.scroller);

    if (this.interactive) {
      this.promptRow = document.createElement('label');
      this.promptRow.className = 'system-terminal__prompt';

      this.promptLabel = document.createElement('span');
      this.promptLabel.className = 'system-terminal__prompt-label';
      this.promptLabel.textContent = this.promptText;

      this.input = document.createElement('input');
      this.input.className = 'system-terminal__input';
      this.input.type = 'text';
      this.input.autocomplete = 'off';
      this.input.autocapitalize = 'off';
      this.input.spellcheck = false;
      this.input.classList.toggle('system-terminal__input--cursor-hidden', !this.showCursor);

      this.promptRow.append(this.promptLabel, this.input);

      this.scroller.append(this.promptRow);

      this.input.addEventListener('keydown', (event) => this.onInputKeyDown(event));
      this.input.addEventListener('input', () => this.onInputChange());
      this.viewport.addEventListener('pointerdown', () => {
        if (this.visible) {
          this.focusInput();
        }
      });
      this.scroller.addEventListener('pointerdown', () => {
        if (this.visible) {
          this.focusInput();
        }
      });
    } else if (this.showCursor) {
      this.cursorRow = document.createElement('div');
      this.cursorRow.className = 'system-terminal__line system-terminal__cursor-row';

      this.cursor = document.createElement('span');
      this.cursor.className = 'system-terminal__cursor';
      this.cursor.setAttribute('aria-hidden', 'true');

      this.cursorRow.append(this.cursor);
      this.scroller.append(this.cursorRow);
    }

    this.root.append(this.frame, this.viewport);
    this.container.append(this.root);

    this.root.addEventListener('pointerdown', (event) => this.onRootPointerDown(event));
    this.root.addEventListener('pointermove', (event) => this.onRootPointerMove(event));
    this.root.addEventListener('pointerup', (event) => this.onRootPointerUp(event));
    this.root.addEventListener('pointercancel', (event) => this.onRootPointerUp(event));
    this.root.addEventListener('click', () => this.focusInput());
    this.root.addEventListener('keydown', (event) => this.onRootKeyDown(event));

    this.applyVariant(this.os);
    this.refreshInteractivity();
  }

  applyVariant(os) {
    this.os = normalizeTerminalOs(os);
    const variant = TERMINAL_VARIANTS[this.os];

    this.frame.src = variant.frameSrc;
    this.root.style.setProperty('--system-terminal-aspect-ratio', `${variant.imageWidth} / ${variant.imageHeight}`);
    this.root.style.setProperty('--system-terminal-content-left', `${(variant.offsetX / variant.imageWidth) * 100}%`);
    this.root.style.setProperty('--system-terminal-content-top', `${(variant.offsetY / variant.imageHeight) * 100}%`);
    this.root.style.setProperty('--system-terminal-content-right', `${(variant.insetRight / variant.imageWidth) * 100}%`);
    this.root.style.setProperty('--system-terminal-content-bottom', `${(variant.insetBottom / variant.imageHeight) * 100}%`);
    this.root.style.setProperty('--system-terminal-font-family', variant.fontFamily);
    this.root.style.setProperty('--system-terminal-color', variant.textColor);
    this.root.style.setProperty('--system-terminal-font-size', variant.fontSize);
    this.root.style.setProperty('--system-terminal-line-height', variant.lineHeight);

    if (this.cursor) {
      this.cursor.textContent = TERMINAL_CURSOR_GLYPHS[this.os];
    }

    if (this.promptLabel) {
      this.promptText = TERMINAL_PROMPTS[this.os];
      this.promptLabel.textContent = this.promptText;
    }
  }

  setZIndex(zIndex) {
    this.root.style.zIndex = String(zIndex);
  }

  refreshInteractivity() {
    this.root.classList.toggle('system-terminal--interactive', this.interactive);
    this.root.classList.toggle('system-terminal--draggable', this.draggable);
    this.root.style.pointerEvents = this.interactive || this.draggable ? 'auto' : 'none';
    this.viewport.style.pointerEvents = this.interactive ? 'auto' : 'none';
  }

  open() {
    if (this.destroyed) return;

    this.visible = true;
    this.closing = false;
    this.root.classList.remove('hidden', 'closing');
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');
    this.focusInput();
  }

  hide({ animate = false, cancelScript = true } = {}) {
    if (this.destroyed) return;

    this.visible = false;
    if (cancelScript) {
      this.stopScript();
    }

    const finishHide = () => {
      this.closing = false;
      this.root.classList.remove('visible', 'closing');
      this.root.classList.add('hidden');
      this.root.setAttribute('aria-hidden', 'true');
    };

    if (!animate) {
      finishHide();
      return;
    }

    this.closing = true;
    this.root.classList.add('closing');
    this.root.classList.remove('visible');
    const timerId = window.setTimeout(() => {
      this.timers = this.timers.filter((value) => value !== timerId);
      if (this.destroyed) return;
      finishHide();
    }, 220);
    this.timers.push(timerId);
  }

  destroy() {
    if (this.destroyed) return;

    this.hide();
    this.destroyed = true;
    if (this.focusFrameId) {
      window.cancelAnimationFrame(this.focusFrameId);
      this.focusFrameId = 0;
    }
    this.stopScript();
    this.root.remove();
    this.onDestroy?.(this);
  }

  clearOutput() {
    this.output.replaceChildren();
    this.scrollToBottom();
  }

  startAppMode(options = {}) {
    if (!this.interactive) return;

    const renderFrame = typeof options.renderFrame === 'function' ? options.renderFrame : null;
    if (!renderFrame) {
      throw new Error('Terminal app mode requires a renderFrame callback.');
    }

    this.stopScript();
    this.appMode = {
      name: String(options.name || 'app'),
      title: String(options.title || options.name || 'APP'),
      hint: String(options.hint || 'Press any key to exit'),
      renderFrame,
      onExit: typeof options.onExit === 'function' ? options.onExit : null,
      state: options.state && typeof options.state === 'object' ? options.state : {},
      frameInterval: Number.isFinite(options.frameInterval) ? Math.max(0, options.frameInterval) : 1 / 24,
      lastFrameTime: -Infinity,
      lastFrame: '',
    };

    this.root.classList.add('system-terminal--app-active');
    this.appScreen.textContent = '';
    this.appScreen.innerHTML = '';
    this.appScreen.style.color = '';
    this.appScreen.setAttribute('aria-hidden', 'false');
    this.scrollToBottom();
    this.open();
    this.focusInput();
    this.renderAppFrame(performance.now() / 1000, 0, {});
  }

  exitAppMode(context = {}) {
    if (!this.appMode) return;

    const appMode = this.appMode;
    this.appMode = null;
    this.root.classList.remove('system-terminal--app-active');
    this.appScreen.textContent = '';
    this.appScreen.innerHTML = '';
    this.appScreen.style.color = '';
    this.appScreen.setAttribute('aria-hidden', 'true');

    const response = appMode.onExit?.({
      terminal: this,
      state: appMode.state,
      triggerKey: context.triggerKey ?? null,
      name: appMode.name,
      title: appMode.title,
    });

    if (response != null) {
      this.appendResponse(response);
    }

    this.scrollToBottom();
    this.focusInput();
  }

  renderAppFrame(time, dt, frameContext = {}) {
    if (!this.appMode) return;
    if (time - this.appMode.lastFrameTime < this.appMode.frameInterval) return;

    const frame = this.appMode.renderFrame({
      terminal: this,
      state: this.appMode.state,
      time,
      dt,
      name: this.appMode.name,
      title: this.appMode.title,
      hint: this.appMode.hint,
      ...frameContext,
    });
    const normalizedFrame = frame && typeof frame === 'object' && !Array.isArray(frame)
      ? {
        text: typeof frame.text === 'string' ? frame.text : '',
        html: typeof frame.html === 'string' ? frame.html : '',
        color: typeof frame.color === 'string' ? frame.color : '',
      }
      : {
        text: Array.isArray(frame) ? frame.join('\n') : String(frame ?? ''),
        html: '',
        color: '',
      };
    const payload = normalizedFrame.html || normalizedFrame.text;

    if (payload !== this.appMode.lastFrame) {
      if (normalizedFrame.html) {
        this.appScreen.innerHTML = normalizedFrame.html;
      } else {
        this.appScreen.textContent = normalizedFrame.text;
      }
      this.appMode.lastFrame = payload;
    }

    if (this.appScreen.style.color !== normalizedFrame.color) {
      this.appScreen.style.color = normalizedFrame.color;
    }

    this.appMode.lastFrameTime = time;
  }

  appendLine(text = '') {
    const entry = document.createElement('div');
    entry.className = 'system-terminal__line';
    entry.textContent = text;
    this.output.append(entry);
    this.scrollToBottom();
  }

  appendResponse(response) {
    if (response == null) return;

    if (Array.isArray(response)) {
      response.forEach((entry) => this.appendResponse(entry));
      return;
    }

    const lines = String(response).replace(/\r/g, '').split('\n');
    lines.forEach((line) => this.appendLine(line));
  }

  scrollToBottom() {
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

  stopScript() {
    this.scriptToken += 1;
    this.timers.forEach((timerId) => window.clearTimeout(timerId));
    this.timers = [];
  }

  playScript(parts, options = {}) {
    const actions = toScriptActions(Array.isArray(parts) ? parts : []);
    const lineDelay = Number.isFinite(options.lineDelay) ? Math.max(0, options.lineDelay) : 100;
    const autoCloseDelay = Number.isFinite(options.autoCloseDelay) ? Math.max(0, options.autoCloseDelay) : null;
    const destroyOnClose = options.destroyOnClose !== false;
    const clearBefore = options.clearBefore !== false;
    const token = this.scriptToken + 1;

    this.stopScript();
    this.scriptToken = token;

    if (clearBefore) {
      this.clearOutput();
    }

    this.fleeOffsetX = 0;
    this.fleeOffsetY = 0;
    this.open();

    let elapsed = 0;

    actions.forEach((action) => {
      if (action.type === 'pause') {
        elapsed += action.duration;
        return;
      }

      const timerId = window.setTimeout(() => {
        if (this.destroyed || this.scriptToken !== token) return;
        this.appendLine(action.text);
      }, elapsed);

      this.timers.push(timerId);
      elapsed += action.delay ?? lineDelay;
    });

    if (autoCloseDelay !== null) {
      const closeTimerId = window.setTimeout(() => {
        if (this.destroyed || this.scriptToken !== token) return;
        this.hide({ animate: true, cancelScript: false });
      }, elapsed + autoCloseDelay);
      this.timers.push(closeTimerId);

      const destroyTimerId = window.setTimeout(() => {
        if (this.destroyed || this.scriptToken !== token) return;
        if (destroyOnClose) {
          this.destroy();
        }
      }, elapsed + autoCloseDelay + 220);
      this.timers.push(destroyTimerId);
    }
  }

  focusInput() {
    if (!this.interactive || !this.visible) return;

    if (this.focusFrameId) {
      window.cancelAnimationFrame(this.focusFrameId);
    }

    this.focusFrameId = window.requestAnimationFrame(() => {
      this.focusFrameId = 0;
      if (!this.interactive || !this.visible) return;

      if (this.appMode) {
        this.root.focus({ preventScroll: true });
        return;
      }

      if (!this.input) return;
      this.input.focus({ preventScroll: true });
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    });
  }

  onInputChange() {
    if (this.suppressInputTracking || !this.input) return;
    if (this.historyIndex !== -1) {
      this.historyIndex = -1;
    }
    this.historyDraft = this.input.value;
  }

  setInputValue(value) {
    if (!this.input) return;

    this.suppressInputTracking = true;
    this.input.value = value;
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.suppressInputTracking = false;
  }

  pushCommandHistory(command) {
    const normalized = String(command ?? '');
    if (!normalized.trim()) return;
    if (this.commandHistory[this.commandHistory.length - 1] === normalized) return;

    this.commandHistory.push(normalized);
    if (this.commandHistory.length > 100) {
      this.commandHistory.shift();
    }
  }

  cycleHistory(direction) {
    if (!this.input || this.commandHistory.length === 0) return;

    if (this.historyIndex === -1) {
      this.historyDraft = this.input.value;
      this.historyIndex = direction < 0 ? this.commandHistory.length - 1 : -1;
    } else {
      this.historyIndex = Math.max(-1, Math.min(this.commandHistory.length - 1, this.historyIndex + direction));
    }

    if (this.historyIndex === -1) {
      this.setInputValue(this.historyDraft);
      return;
    }

    this.setInputValue(this.commandHistory[this.historyIndex]);
  }

  getLongestCommonPrefix(values) {
    if (values.length === 0) return '';

    let prefix = values[0];
    for (let index = 1; index < values.length; index += 1) {
      while (!values[index].startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
      if (!prefix) break;
    }

    return prefix;
  }

  completeInput() {
    if (!this.input || !this.getCompletions) return;

    const cursorIndex = this.input.selectionStart ?? this.input.value.length;
    const beforeCursor = this.input.value.slice(0, cursorIndex);
    const afterCursor = this.input.value.slice(cursorIndex);
    if (/\s/.test(beforeCursor.trim())) return;

    const prefix = beforeCursor.trimStart().toLowerCase();
    const matches = this.getCompletions(prefix, this) ?? [];
    if (matches.length === 0) return;

    if (matches.length === 1) {
      this.setInputValue(`${matches[0]} ${afterCursor}`);
      return;
    }

    const sharedPrefix = this.getLongestCommonPrefix(matches);
    if (sharedPrefix.length > prefix.length) {
      this.setInputValue(`${sharedPrefix}${afterCursor}`);
    }
  }

  async onInputKeyDown(event) {
    if (this.appMode) return;

    if (event.key === 'Tab') {
      event.preventDefault();
      this.completeInput();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.cycleHistory(-1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.cycleHistory(1);
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();

    const rawValue = this.input.value;
    const command = rawValue.trim();

    this.appendLine(`${this.promptText}${rawValue}`);
    this.input.value = '';
    this.historyIndex = -1;
    this.historyDraft = '';
    this.scrollToBottom();

    if (!command || !this.onCommand) {
      return;
    }

    this.pushCommandHistory(rawValue);
    const response = await this.onCommand(command, this);
    this.appendResponse(response);
  }

  onRootKeyDown(event) {
    if (!this.appMode) return;
    if (event.target === this.input) return;

    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;

    event.preventDefault();
    this.exitAppMode({ triggerKey: event.key });
  }

  onRootPointerDown(event) {
    this.onFocus?.(this);
    this.focusInput();

    if (!this.draggable || !this.visible) return;
    if (this.viewport.contains(event.target)) return;

    event.preventDefault();

    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.manualOffsetX,
      originY: this.manualOffsetY,
    };
    this.root.setPointerCapture(event.pointerId);
  }

  onRootPointerMove(event) {
    if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;

    this.manualOffsetX = this.dragState.originX + (event.clientX - this.dragState.startX);
    this.manualOffsetY = this.dragState.originY + (event.clientY - this.dragState.startY);
  }

  onRootPointerUp(event) {
    if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;

    if (this.root.hasPointerCapture(event.pointerId)) {
      this.root.releasePointerCapture(event.pointerId);
    }

    this.dragState = null;
  }

  update(time, dt, pointerState, effectState, frameContext = {}) {
    if (this.destroyed || (!this.visible && !this.closing)) return;

    const wobbleScale = this.wobbleScale;
    const fringe = Number(effectState?.fringe) || 0;
    const distortion = Number(effectState?.distortion) || 0;

    if (!this.draggable) {
      const rect = this.root.getBoundingClientRect();
      const centerX = rect.left + rect.width * 0.5;
      const centerY = rect.top + rect.height * 0.5;
      const awayX = centerX - pointerState.position.x;
      const awayY = centerY - pointerState.position.y;
      const distance = Math.hypot(awayX, awayY);
      const speed = Math.hypot(pointerState.velocity.x, pointerState.velocity.y);
      const radius = Math.max(rect.width, rect.height) * 0.78;
      const isPointerInside = pointerState.position.x >= rect.left
        && pointerState.position.x <= rect.right
        && pointerState.position.y >= rect.top
        && pointerState.position.y <= rect.bottom;
      const proximity = clamp(1 - distance / radius, 0, 1);
      const approach = speed > 0.001 && distance > 0.001
        ? clamp((pointerState.velocity.x * awayX + pointerState.velocity.y * awayY) / (speed * distance), 0, 1)
        : 0;
      const threat = pointerState.active
        ? isPointerInside
          ? 1
          : proximity > 0 && (approach > 0.12 || distance < Math.min(rect.width, rect.height) * 0.32)
            ? proximity * (0.55 + approach * 0.75)
            : 0
        : 0;
      const maxTravelX = Math.max(0, window.innerWidth * 0.5 - rect.width * 0.58 - 28);
      const maxTravelY = Math.max(0, window.innerHeight * 0.5 - rect.height * 0.58 - 28);
      const directionX = distance > 0.001 ? awayX / distance : (pointerState.velocity.x <= 0 ? 1 : -1);
      const directionY = distance > 0.001 ? awayY / distance : (pointerState.velocity.y <= 0 ? 1 : -1);
      const rawTargetX = threat > 0 ? directionX * maxTravelX * Math.min(1, threat * 1.35) : this.fleeOffsetX;
      const rawTargetY = threat > 0 ? directionY * maxTravelY * Math.min(1, threat * 1.05) : this.fleeOffsetY;
      const targetOffsetX = threat > 0 && Math.abs(rawTargetX) < Math.abs(this.fleeOffsetX)
        ? this.fleeOffsetX
        : rawTargetX;
      const targetOffsetY = threat > 0 && Math.abs(rawTargetY) < Math.abs(this.fleeOffsetY)
        ? this.fleeOffsetY
        : rawTargetY;
      const evadeBlend = Math.min(1, dt * (threat > 0 ? 11 : 5));

      this.fleeOffsetX = lerp(this.fleeOffsetX, targetOffsetX, evadeBlend);
      this.fleeOffsetY = lerp(this.fleeOffsetY, targetOffsetY, evadeBlend);
    } else if (!this.dragState) {
      this.fleeOffsetX = lerp(this.fleeOffsetX, 0, Math.min(1, dt * 6));
      this.fleeOffsetY = lerp(this.fleeOffsetY, 0, Math.min(1, dt * 6));
    }

    const shiftX = Math.sin(time * 18) * (1.2 + fringe * 6) * wobbleScale + this.fleeOffsetX;
    const shiftY = Math.cos(time * 13) * (0.8 + distortion * 4) * wobbleScale + this.fleeOffsetY;

    this.root.style.setProperty('--system-terminal-base-x', `${this.baseOffsetX + this.manualOffsetX}px`);
    this.root.style.setProperty('--system-terminal-base-y', `${this.baseOffsetY + this.manualOffsetY}px`);
    this.root.style.setProperty('--system-terminal-shift-x', `${shiftX.toFixed(2)}px`);
    this.root.style.setProperty('--system-terminal-shift-y', `${shiftY.toFixed(2)}px`);
    this.root.style.setProperty('--system-terminal-opacity', `${0.96 - distortion * 0.08}`);
    this.root.style.setProperty('--system-terminal-glow', `${0.08 + fringe * 0.12}`);

    if (this.appMode) {
      this.renderAppFrame(time, dt, frameContext);
    }
  }
}
