// Dummy env values so requiring digest.js (which requires api.js, which
// calls createClient() at module load) doesn't throw — these tests only
// exercise the pure buildDigestGroups()/buildDigestEmailHtml() functions,
// never an actual Supabase or email call.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";
process.env.HUB_PASSWORD = process.env.HUB_PASSWORD || "test-hub-password";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDigestGroups, buildDigestEmailHtml } = require("./digest.js");

// Fixed "today"/horizon for every test: today = 2026-06-15,
// horizon = today + 14 days = 2026-06-29 (matches WEEKLY_HORIZON_DAYS).
const TODAY = new Date("2026-06-15T00:00:00");
const HORIZON_STR = "2026-06-29";

test("buildDigestGroups drops events with nothing due", () => {
  const events = [
    { id: "e1", name: "Event Far Away", event_date: "2027-06-20" }, // nothing due within horizon
  ];
  const groups = buildDigestGroups(events, {}, {}, HORIZON_STR, TODAY);
  assert.deepEqual(groups, []);
});

test("buildDigestGroups includes an event with an overdue milestone", () => {
  const events = [
    { id: "e1", name: "Business beim Brötchen", event_date: "2026-06-20" },
  ];
  const groups = buildDigestGroups(events, {}, {}, HORIZON_STR, TODAY);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].event_name, "Business beim Brötchen");
  assert.ok(groups[0].items.length > 0);
});

test("buildDigestGroups sorts items within a group most-overdue-first", () => {
  const events = [
    { id: "e1", name: "Event A", event_date: "2026-06-20" },
  ];
  const groups = buildDigestGroups(events, {}, {}, HORIZON_STR, TODAY);
  const days = groups[0].items.map((i) => i.days_until_due);
  const sorted = [...days].sort((a, b) => a - b);
  assert.deepEqual(days, sorted);
});

test("buildDigestGroups sorts groups by their own most-urgent item, most overdue first", () => {
  const events = [
    // Event B's event_date is closer to today, so its earliest offsets
    // (further overdue) land more overdue than Event A's.
    { id: "a", name: "Event A (less overdue)", event_date: "2026-06-25" },
    { id: "b", name: "Event B (more overdue)", event_date: "2026-06-16" },
  ];
  const groups = buildDigestGroups(events, {}, {}, HORIZON_STR, TODAY);
  assert.equal(groups[0].event_name, "Event B (more overdue)");
  assert.equal(groups[1].event_name, "Event A (less overdue)");
});

test("buildDigestGroups excludes items marked done via msDoneByEvent/wfDoneByEvent", () => {
  const events = [{ id: "e1", name: "Event A", event_date: "2026-06-20" }];
  const msDoneByEvent = { e1: new Set(["m10w", "m8w", "m7w", "m6w", "m4w", "m3w", "m2w", "m1w", "m1d"]) };
  const wfDoneByEvent = {
    e1: new Set([
      "pflicht_ag1", "pflicht_ei3", "pflicht_ei4", "pflicht_ko3",
      "pflicht_lo1", "pflicht_lo2", "social_sa4", "social_sr3",
      "pixlip_px6", "pixlip_pv2",
    ]),
  };
  const groups = buildDigestGroups(events, msDoneByEvent, wfDoneByEvent, HORIZON_STR, TODAY);
  // Everything that could possibly be due is marked done — nothing left.
  assert.deepEqual(groups, []);
});

test("buildDigestGroups skips events with no event_date", () => {
  const events = [{ id: "e1", name: "No Date Event", event_date: null }];
  const groups = buildDigestGroups(events, {}, {}, HORIZON_STR, TODAY);
  assert.deepEqual(groups, []);
});

test("buildDigestEmailHtml reports nothing due when groups is empty", () => {
  const html = buildDigestEmailHtml([], 14);
  assert.match(html, /Keine fälligen oder überfälligen/);
});

test("buildDigestEmailHtml includes every event's name and item labels, grouped", () => {
  const groups = [
    {
      event_id: "e1",
      event_name: "Business beim Brötchen",
      items: [
        { type: "milestone", key: "m10w", label: "−10W: Anfragen", due_date: "2026-06-01", days_until_due: -14 },
        { type: "workflow", key: "pflicht_ag1", label: "Agenda vollständig", due_date: "2026-06-10", days_until_due: -5 },
      ],
    },
  ];
  const html = buildDigestEmailHtml(groups, 14);
  assert.match(html, /Business beim Brötchen/);
  assert.match(html, /−10W: Anfragen/);
  assert.match(html, /Agenda vollständig/);
  assert.match(html, /überfällig seit 14 Tagen/);
  assert.match(html, /überfällig seit 5 Tagen/);
});

test("buildDigestEmailHtml distinguishes overdue vs due-today vs upcoming phrasing", () => {
  const groups = [
    {
      event_id: "e1",
      event_name: "Event A",
      items: [
        { type: "milestone", key: "overdue", label: "Overdue Item", due_date: "2026-06-10", days_until_due: -5 },
        { type: "milestone", key: "today", label: "Today Item", due_date: "2026-06-15", days_until_due: 0 },
        { type: "milestone", key: "soon", label: "Soon Item", due_date: "2026-06-18", days_until_due: 3 },
      ],
    },
  ];
  const html = buildDigestEmailHtml(groups, 14);
  assert.match(html, /Overdue Item — überfällig seit 5 Tagen/);
  assert.match(html, /Today Item — heute fällig/);
  assert.match(html, /Soon Item — fällig in 3 Tagen/);
});
