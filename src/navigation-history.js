// Stamp browser entries so Back never leaves the app's known navigation trail.
export class NavigationHistory {
  constructor(history = globalThis.history) {
    this.history = history;
    this.index = 0;
    this.session = history.state?.cgsNavigation?.session ?? globalThis.crypto.randomUUID();
    this.sync(true);
  }

  sync(initial = false) {
    const entry = this.history.state?.cgsNavigation;
    if (entry?.session === this.session && Number.isSafeInteger(entry.index) && entry.index >= 0) {
      this.index = entry.index;
    } else {
      this.index = initial ? 0 : this.index + 1;
      this.history.replaceState({ ...this.history.state,
        cgsNavigation: { session: this.session, index: this.index }
      }, "");
    }
  }

  get canGoBack() { return this.index > 0; }

  back() {
    if (this.canGoBack) this.history.back();
  }
}
