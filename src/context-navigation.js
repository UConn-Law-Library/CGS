export function aggregateShardCounts(shards = [], countKey = "headingCount") {
  const counts = new Map();
  for (const shard of shards) {
    if (!shard?.key) continue;
    counts.set(shard.key, (counts.get(shard.key) ?? 0) + Math.max(0, Number(shard[countKey]) || 0));
  }
  return counts;
}

export function contextualColumnCount(area, route = {}) {
  if (area === "statutes") {
    if (route.kind === "home") return 1;
    if (route.kind === "title") return 2;
    if (route.kind === "chapter" || route.kind === "section") return 3;
  }
  if (area === "index") return route.letter ? 2 : 1;
  if (area === "infractions") return route.category ? 2 : 1;
  return 0;
}
