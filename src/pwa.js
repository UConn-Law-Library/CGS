const initialState = Object.freeze({
  supported: false,
  ready: false,
  installable: false,
  installed: false,
  updateAvailable: false,
  busy: false,
  cachedFiles: 0,
  totalFiles: 0,
  complete: false,
  persistentStorageSupported: false,
  persistentStorageGranted: null,
  storageUsage: null,
  storageQuota: null,
  downloadedAt: null,
  verifiedFiles: 0,
  verifiedBytes: 0,
  corpus: null,
  secondary: null,
  search: null,
  supplements: [],
  shellBuildId: null,
  currentRelease: null,
  compatibility: { compatible: null, reason: null },
  error: null
});

const offlineStateKeys = [
  "cachedFiles", "totalFiles", "complete", "downloadedAt", "verifiedFiles", "verifiedBytes",
  "corpus", "secondary", "search", "supplements", "shellBuildId", "currentRelease", "compatibility"
];

export class PwaManager {
  #navigator;
  #window;
  #registration = null;
  #installPrompt = null;
  #listeners = new Set();
  #MessageChannel;
  #hadController;
  state;

  constructor({
    navigatorObject = globalThis.navigator,
    windowObject = globalThis.window,
    MessageChannelClass = globalThis.MessageChannel
  } = {}) {
    this.#navigator = navigatorObject;
    this.#window = windowObject;
    this.#MessageChannel = MessageChannelClass;
    this.#hadController = Boolean(navigatorObject?.serviceWorker?.controller);
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
    this.#navigator?.serviceWorker?.addEventListener?.("controllerchange", () => {
      if (this.#hadController) this.#update({ updateAvailable: true });
      this.#hadController = true;
    });
    await this.refreshPersistenceStatus();
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
    await this.refreshStorageEstimate();
    return this.state;
  }

  async refreshStorageEstimate() {
    try {
      const estimate = await this.#navigator.storage?.estimate?.();
      if (estimate) {
        this.#update({
          storageUsage: Number.isFinite(estimate.usage) ? estimate.usage : null,
          storageQuota: Number.isFinite(estimate.quota) ? estimate.quota : null
        });
      }
    } catch {
      // Storage estimates are optional and must not block the app.
    }
    return this.state;
  }

  async refreshPersistenceStatus() {
    const storage = this.#navigator?.storage;
    const supported = typeof storage?.persist === "function";
    let granted = null;
    try {
      if (typeof storage?.persisted === "function") granted = Boolean(await storage.persisted());
    } catch {
      // Persistence reporting is optional and must not block the app.
    }
    this.#update({ persistentStorageSupported: supported, persistentStorageGranted: granted });
    return this.state;
  }

  async requestPersistentStorage() {
    const storage = this.#navigator?.storage;
    if (typeof storage?.persist !== "function") {
      this.#update({ persistentStorageSupported: false, persistentStorageGranted: null });
      return null;
    }
    try {
      if (typeof storage.persisted === "function" && await storage.persisted()) {
        this.#update({ persistentStorageSupported: true, persistentStorageGranted: true });
        return true;
      }
      const granted = Boolean(await storage.persist());
      this.#update({ persistentStorageSupported: true, persistentStorageGranted: granted });
      return granted;
    } catch {
      this.#update({ persistentStorageSupported: true, persistentStorageGranted: false });
      return false;
    }
  }

  applyUpdate() {
    if (!this.state.updateAvailable) return false;
    this.#window?.location?.reload?.();
    return true;
  }

  async downloadOfflineData({ refresh = false } = {}) {
    return this.#downloadOfflineData({ type: "DOWNLOAD_OFFLINE_DATA", action: refresh ? "Refresh" : "Download" });
  }

  async repairOfflineData() {
    return this.#downloadOfflineData({ type: "REPAIR_OFFLINE_DATA", action: "Repair" });
  }

  async #downloadOfflineData({ type, action }) {
    const previous = Object.fromEntries(offlineStateKeys.map((key) => [key, this.state[key]]));
    this.#update({ busy: true, error: null });
    try {
      await this.requestPersistentStorage();
      const result = await this.#request(type, {}, (progress) => {
        this.#update({ cachedFiles: progress.completed, totalFiles: progress.total });
      });
      this.#update({ ...result, busy: false, error: null });
      await this.refreshStorageEstimate();
      return result;
    } catch (error) {
      const recovery = previous.complete
        ? "Your previous offline copy is still available."
        : "No incomplete download was kept.";
      this.#update({
        ...previous,
        busy: false,
        error: `${action} interrupted. ${recovery} Select ${action.toLowerCase()} to retry. ${error.message}`
      });
      await this.refreshStorageEstimate();
      throw error;
    }
  }

  async clearOfflineData() {
    this.#update({ busy: true, error: null });
    try {
      const result = await this.#request("CLEAR_OFFLINE_DATA");
      this.#update({ ...result, busy: false, error: null });
      await this.refreshStorageEstimate();
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
