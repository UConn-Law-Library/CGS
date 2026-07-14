const initialState = Object.freeze({
  supported: false,
  ready: false,
  installable: false,
  installed: false,
  busy: false,
  cachedFiles: 0,
  totalFiles: 0,
  complete: false,
  error: null
});

export class PwaManager {
  #navigator;
  #window;
  #registration = null;
  #installPrompt = null;
  #listeners = new Set();
  #MessageChannel;
  state;

  constructor({
    navigatorObject = globalThis.navigator,
    windowObject = globalThis.window,
    MessageChannelClass = globalThis.MessageChannel
  } = {}) {
    this.#navigator = navigatorObject;
    this.#window = windowObject;
    this.#MessageChannel = MessageChannelClass;
    const installed = Boolean(
      navigatorObject?.standalone
      || windowObject?.matchMedia?.("(display-mode: standalone)")?.matches
    );
    this.state = { ...initialState, supported: Boolean(navigatorObject?.serviceWorker), installed };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  #update(changes) {
    this.state = { ...this.state, ...changes };
    for (const listener of this.#listeners) listener(this.state);
  }

  async init() {
    this.#window?.addEventListener?.("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.#installPrompt = event;
      this.#update({ installable: true });
    });
    this.#window?.addEventListener?.("appinstalled", () => {
      this.#installPrompt = null;
      this.#update({ installed: true, installable: false });
    });
    if (!this.state.supported) return this.state;
    try {
      this.#registration = await this.#navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      await this.#navigator.serviceWorker.ready;
      this.#update({ ready: true, error: null });
      await this.refreshStatus();
    } catch (error) {
      this.#update({ error: error.message });
    }
    return this.state;
  }

  async install() {
    if (!this.#installPrompt) return { outcome: "unavailable" };
    await this.#installPrompt.prompt();
    const choice = await this.#installPrompt.userChoice;
    this.#installPrompt = null;
    this.#update({ installable: false, installed: choice.outcome === "accepted" || this.state.installed });
    return choice;
  }

  async refreshStatus() {
    if (!this.state.ready) return this.state;
    const status = await this.#request("OFFLINE_STATUS");
    this.#update({ ...status, error: null });
    return this.state;
  }

  async downloadOfflineData({ refresh = false } = {}) {
    this.#update({ busy: true, error: null });
    try {
      const result = await this.#request("DOWNLOAD_OFFLINE_DATA", { refresh }, (progress) => {
        this.#update({ cachedFiles: progress.completed, totalFiles: progress.total });
      });
      this.#update({ ...result, busy: false, error: null });
      return result;
    } catch (error) {
      this.#update({ busy: false, error: error.message });
      throw error;
    }
  }

  async clearOfflineData() {
    this.#update({ busy: true, error: null });
    try {
      const result = await this.#request("CLEAR_OFFLINE_DATA");
      this.#update({ ...result, busy: false, error: null });
      return result;
    } catch (error) {
      this.#update({ busy: false, error: error.message });
      throw error;
    }
  }

  async #request(type, payload = {}, onProgress = null) {
    const registration = this.#registration ?? await this.#navigator.serviceWorker.ready;
    const target = this.#navigator.serviceWorker.controller ?? registration.active ?? registration.waiting;
    if (!target || !this.#MessageChannel) throw new Error("The offline worker is not ready yet.");
    return new Promise((resolve, reject) => {
      const channel = new this.#MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        if (data.type === "progress") onProgress?.(data);
        else if (data.type === "complete") resolve(data.result);
        else if (data.type === "error") reject(new Error(data.message));
      };
      target.postMessage({ type, payload }, [channel.port2]);
    });
  }
}
