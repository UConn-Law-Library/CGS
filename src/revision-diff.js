const TOKEN_PATTERN = /\s+|[\p{Letter}\p{Number}]+(?:['\u2019\-][\p{Letter}\p{Number}]+)*|[^\s\p{Letter}\p{Number}]/gu;
const DEFAULT_MAX_EDIT_DISTANCE = 2000;

function tokens(value) {
  return String(value ?? "").match(TOKEN_PATTERN) ?? [];
}

function coalesce(edits) {
  const segments = [];
  for (const edit of edits) {
    const previous = segments.at(-1);
    if (previous?.type === edit.type) previous.text += edit.text;
    else segments.push({ ...edit });
  }
  return segments.filter((segment) => segment.text);
}

function backtrack(trace, before, after) {
  let x = before.length;
  let y = after.length;
  const edits = [];
  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = x - y;
    const previousDiagonal = diagonal === -distance
      || (diagonal !== distance
        && (frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY)
          < (frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY))
      ? diagonal + 1
      : diagonal - 1;
    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      edits.push({ type: "equal", text: before[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (distance === 0) break;
    if (x === previousX) {
      y -= 1;
      edits.push({ type: "insert", text: after[y] });
    } else {
      x -= 1;
      edits.push({ type: "delete", text: before[x] });
    }
  }
  return coalesce(edits.reverse());
}

export function diffRevisionText(beforeText, afterText, { maxEditDistance = DEFAULT_MAX_EDIT_DISTANCE } = {}) {
  const before = tokens(beforeText);
  const after = tokens(afterText);
  if (!before.length) return after.length ? [{ type: "insert", text: after.join("") }] : [];
  if (!after.length) return [{ type: "delete", text: before.join("") }];
  if (before.length === after.length && before.every((token, index) => token === after[index])) {
    return [{ type: "equal", text: before.join("") }];
  }

  const frontier = new Map([[1, 0]]);
  const trace = [];
  const maximum = Math.min(before.length + after.length, maxEditDistance);
  for (let distance = 0; distance <= maximum; distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      const right = (frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) + 1;
      let x = diagonal === -distance || (diagonal !== distance && right < down) ? down : right;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length) return backtrack(trace, before, after);
    }
  }

  return [
    { type: "delete", text: before.join("") },
    { type: "insert", text: after.join("") }
  ];
}
