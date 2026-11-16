import assert from "node:assert/strict";
import test from "node:test";
import { actsCurrencyNote, normalizeActsOptions, partitionSessions, renderPastSessions, sessionCoverage } from "../src/acts.js";
import { amendmentsForSection, pendingSessionIds } from "../src/act-amendments.js";
import { actsRouteHref, parseRoute } from "../src/routes.js";

const counts = { acts: 2, publicActs: 1, specialActs: 1, textActs: 2 };
const sessions = [
  { id: "2027-regular", year: 2027, name: "2027 Regular Session", counts },
  { id: "2026-june-special", year: 2026, name: "2026 June Special Session", counts },
  { id: "2026-regular", year: 2026, name: "2026 Regular Session", counts },
  { id: "2025-regular", year: 2025, name: "2025 Regular Session", counts }
];
const before = { baseRevisionYear: 2025, supplementEditionYear: 2026 };
const after = { baseRevisionYear: 2027, supplementEditionYear: null };

test("session coverage follows the active edition, for regular and special sessions alike", () => {
  // Today: the 2025 revision with the 2026 Supplement covers legislation through 2025.
  assert.deepEqual(Object.values(partitionSessions(sessions, before)).map((list) => list.map((session) => session.id)),
    [["2027-regular", "2026-june-special", "2026-regular"], ["2025-regular"]]);
  // Once the 2027 revision is active, every 2026 session moves to Past sessions.
  assert.deepEqual(Object.values(partitionSessions(sessions, after)).map((list) => list.map((session) => session.id)),
    [["2027-regular"], ["2026-june-special", "2026-regular", "2025-regular"]]);
  assert.equal(sessionCoverage(sessions[0], {}), "recent");
});

test("notices and the recent list use the same rule", () => {
  const index = {
    sessions,
    acts: Object.fromEntries(sessions.map((session) => [`${session.id}/1`, { session: session.id, number: 1, citation: `P.A. ${session.year % 100}-1` }])),
    citations: { "1-1": sessions.map((session) => ({ act: `${session.id}/1`, section: "1", action: "amended" })) },
    ranges: []
  };
  for (const years of [before, after]) {
    assert.deepEqual([...pendingSessionIds(index, years)], partitionSessions(sessions, years).recent.map((session) => session.id));
  }
  assert.deepEqual(amendmentsForSection(index, { citations: ["1-1"] }, after).map((act) => act.session), ["2027-regular"]);
});

test("past sessions keep their links and say why they moved", () => {
  const { past } = partitionSessions(sessions, after);
  const html = renderPastSessions(past, after, { sessionHref: (session) => actsRouteHref({ session: session.id }) });
  assert.match(html, /The 2027 General Statutes in this app covers legislation through the 2026 sessions/);
  assert.match(html, /href="#\/acts\?session=2026-june-special"/);
  assert.match(html, /<h2 id="past-sessions-2026">2026<\/h2>/);
  assert.match(renderPastSessions([], before, { sessionHref: () => "" }), /No past sessions yet/);
  assert.match(actsCurrencyNote(sessions[2], after), /should already be reflected in the 2027 General Statutes text in this app, which covers legislation through the 2026 sessions\. This session is kept under Past sessions/);
  // The routes are unchanged: a saved act link still parses to the same act and section.
  assert.deepEqual(parseRoute({ hash: "#/acts/2026-regular/pa-2?section=3" }), { kind: "act", session: "2026-regular", act: "pa-2026-regular-2", section: "3", sections: null, query: null });
  assert.equal(normalizeActsOptions(parseRoute({ hash: "#/acts?view=past" })).view, "past");
  assert.equal(actsRouteHref({ view: "past" }), "#/acts?view=past");
});
