export class SecondarySourceRepository {
  #baseUrl;
  #fetch;
  #manifests;
  #cache = new Map();

  constructor({ baseUrl = "./data/secondary/", fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #json(relativePath) {
    if (!this.#cache.has(relativePath)) {
      this.#cache.set(relativePath, (async () => {
        const response = await this.#fetch(new URL(relativePath, this.#baseUrl));
        if (!response.ok) throw new Error(`Could not load secondary source ${relativePath} (${response.status})`);
        return response.json();
      })());
    }
    return this.#cache.get(relativePath);
  }

  async init() {
    this.#manifests ??= Promise.all([
      this.#json("manifest.json"),
      this.#json("infractions/manifest.json"),
      this.#json("statutes-index/manifest.json"),
      this.#json("links/manifest.json")
    ]).then(([root, infractions, index, links]) => ({ root, infractions, index, links }));
    return this.#manifests;
  }

  async loadInfractions(titleId) {
    const { infractions } = await this.init();
    const entry = infractions.shards.find((shard) => shard.key === titleId);
    return entry ? this.#json(`infractions/${entry.path}`) : { schemaVersion: rootSchema(infractions), titleId, entries: [] };
  }

  async loadFeeRules() {
    return this.#json("infractions/fee-rules.json");
  }

  async loadIndexLetter(letter) {
    const key = String(letter ?? "").trim().toLowerCase().slice(0, 1) || "other";
    const { index } = await this.init();
    const entries = index.shards.filter((shard) => shard.key === key);
    const shards = await Promise.all(entries.map((entry) => this.#json(`statutes-index/${entry.path}`)));
    return shards.flatMap((shard) => shard.headings);
  }

  async loadSectionLinks(titleId, citation) {
    const { links } = await this.init();
    const entry = links.shards.find((shard) => shard.titleId === titleId);
    if (!entry) return emptySectionLinks();
    const shard = await this.#json(`links/${entry.path}`);
    return shard.sections[citation] ?? emptySectionLinks();
  }
}

function rootSchema(manifest) {
  return manifest.schemaVersion ?? "1.0.0";
}

function emptySectionLinks() {
  return { infractions: [], feeRules: [], indexEntries: [] };
}
