(function registerOfflineIntegrity(scope) {
  function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function verifyArtifactBytes(bytes, expected, cryptoObject = scope.crypto) {
    const actualBytes = bytes.byteLength;
    if (!Number.isInteger(expected?.bytes) || !/^[a-f0-9]{64}$/i.test(expected?.sha256 ?? "")) {
      throw new Error(`Integrity metadata is missing for ${expected?.path ?? "an offline artifact"}.`);
    }
    if (actualBytes !== expected.bytes) {
      throw new Error(`Integrity check failed for ${expected.path}: expected ${expected.bytes} bytes, received ${actualBytes}.`);
    }
    if (!cryptoObject?.subtle) throw new Error("SHA-256 verification is unavailable in this browser.");
    const actualHash = bytesToHex(await cryptoObject.subtle.digest("SHA-256", bytes));
    if (actualHash !== expected.sha256.toLowerCase()) {
      throw new Error(`Integrity check failed for ${expected.path}: SHA-256 does not match the published manifest.`);
    }
    return { bytes: actualBytes, sha256: actualHash };
  }

  scope.CgsOfflineIntegrity = Object.freeze({ bytesToHex, verifyArtifactBytes });
})(globalThis);
