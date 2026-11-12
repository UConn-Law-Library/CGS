const DATA_RELEASE_ID = "__CGS_DATA_RELEASE_ID__";

// Dispatched on the page when the service worker refuses a request from an older release.
export const DATA_RELEASE_CHANGED_EVENT = "cgs:data-release-changed";

// The service worker answers 409 when a newer data release took control of this tab after it
// loaded. Retrying cannot succeed; only a reload loads the matching release.
export class DataReleaseChangedError extends Error {
  constructor(label) {
    super(`${label} is from an earlier edition (data release changed)`);
    this.name = "DataReleaseChangedError";
  }
}

// Also recognizes the error after it crossed from the search worker, which keeps only the message.
export function isDataReleaseChanged(error) {
  return error?.name === "DataReleaseChangedError" || /\(data release changed\)/.test(String(error?.message ?? ""));
}

// Every data fetch goes through this, so a release change is reported the same way everywhere.
export function checkDataResponse(response, label) {
  if (response.status === 409) {
    globalThis.dispatchEvent?.(new Event(DATA_RELEASE_CHANGED_EVENT));
    throw new DataReleaseChangedError(label);
  }
  if (!response.ok) throw new Error(`Could not load ${label} (${response.status})`);
  return response;
}

// A tab keeps its generation even if a newer service worker takes control.
export function dataUrl(path) {
  if (DATA_RELEASE_ID.startsWith("__")) return path;
  const url = new URL(path, globalThis.location?.href ?? "http://localhost/");
  url.searchParams.set("release", DATA_RELEASE_ID);
  return url;
}

// Share successful requests, but never retain a rejected request across retries.
export function retryableLoader(load) {
  let pending;
  return () => pending ??= Promise.resolve().then(load).catch((error) => {
    pending = undefined;
    throw error;
  });
}

export async function getJson(path) {
  const response = await fetch(dataUrl(path), { signal: AbortSignal.timeout(15000) });
  checkDataResponse(response, path);
  return response.json();
}
