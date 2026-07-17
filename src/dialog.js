export class NativeDialogController {
  #dialog;
  #trigger = null;
  #onClose;

  constructor(dialog) {
    this.#dialog = dialog;
    this.#onClose = () => {
      const trigger = this.#trigger;
      this.#trigger = null;
      trigger?.focus?.();
    };
    this.#dialog.addEventListener("close", this.#onClose);
  }

  open(trigger) {
    this.#trigger = trigger;
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  close() {
    if (this.#dialog.open) this.#dialog.close();
  }

  destroy() {
    this.#dialog.removeEventListener("close", this.#onClose);
    this.#trigger = null;
  }
}
