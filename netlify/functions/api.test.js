// Dummy env values so requiring api.js (which calls createClient() and reads
// HUB_PASSWORD at module load) doesn't throw — these tests only exercise the
// pure helper functions, never an actual Supabase call.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";
process.env.HUB_PASSWORD = process.env.HUB_PASSWORD || "test-hub-password";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAllowedEventFields,
  checkHubOnlyEventFields,
  HUB_ONLY_EVENT_FIELDS,
  checkEventCanBeArchived,
  sanitizeEventUpdateFields,
  computeWeeklyDueItems,
  WEEKLY_MILESTONE_OFFSETS,
  WEEKLY_WORKFLOW_TASKS,
} = require("./api.js");

test("HUB_ONLY_EVENT_FIELDS locks exactly name and event_date", () => {
  assert.deepEqual([...HUB_ONLY_EVENT_FIELDS].sort(), ["event_date", "name"]);
});

test("PM (token) allowed event fields exclude name and event_date", () => {
  const allowed = getAllowedEventFields(true);
  assert.equal(allowed.includes("name"), false);
  assert.equal(allowed.includes("event_date"), false);
});

test("Hub (password) allowed event fields include name and event_date", () => {
  const allowed = getAllowedEventFields(false);
  assert.ok(allowed.includes("name"));
  assert.ok(allowed.includes("event_date"));
});

test("PM changing the event name is rejected", () => {
  const currentEvent = { name: "Original Name", event_date: "2026-01-01" };
  const violation = checkHubOnlyEventFields(
    true,
    { name: "Hacked Name" },
    currentEvent,
  );
  assert.match(violation, /name/);
});

test("PM changing the event date is rejected", () => {
  const currentEvent = { name: "Original Name", event_date: "2026-01-01" };
  const violation = checkHubOnlyEventFields(
    true,
    { event_date: "2026-02-02" },
    currentEvent,
  );
  assert.match(violation, /event_date/);
});

test("PM re-sending the unchanged name/date alongside a real edit is allowed", () => {
  const currentEvent = { name: "Original Name", event_date: "2026-01-01" };
  const violation = checkHubOnlyEventFields(
    true,
    { name: "Original Name", event_date: "2026-01-01", topic: "New topic" },
    currentEvent,
  );
  assert.equal(violation, null);
});

test("PM omitting name/event_date entirely is allowed", () => {
  const currentEvent = { name: "Original Name", event_date: "2026-01-01" };
  const violation = checkHubOnlyEventFields(
    true,
    { topic: "New topic" },
    currentEvent,
  );
  assert.equal(violation, null);
});

test("Hub (password path) is never blocked from changing name/date", () => {
  const currentEvent = { name: "Original Name", event_date: "2026-01-01" };
  const violation = checkHubOnlyEventFields(
    false,
    { name: "New Name", event_date: "2026-02-02" },
    currentEvent,
  );
  assert.equal(violation, null);
});

test("checkHubOnlyEventFields is a no-op when there is no currentEvent (e.g. missing/new event)", () => {
  const violation = checkHubOnlyEventFields(true, { name: "New Name" }, null);
  assert.equal(violation, null);
});

test("checkEventCanBeArchived allows a past event", () => {
  const violation = checkEventCanBeArchived("2026-01-01", "2026-06-15");
  assert.equal(violation, null);
});

test("checkEventCanBeArchived rejects today's event", () => {
  const violation = checkEventCanBeArchived("2026-06-15", "2026-06-15");
  assert.match(violation, /vergangene/);
});

test("checkEventCanBeArchived rejects a future event", () => {
  const violation = checkEventCanBeArchived("2026-12-31", "2026-06-15");
  assert.match(violation, /vergangene/);
});

test("checkEventCanBeArchived rejects an event with no date", () => {
  const violation = checkEventCanBeArchived(null, "2026-06-15");
  assert.match(violation, /kein Datum/);
  const violationEmpty = checkEventCanBeArchived("", "2026-06-15");
  assert.match(violationEmpty, /kein Datum/);
});

test("checkEventCanBeArchived defaults todayStr to the real current date when omitted", () => {
  // A date guaranteed to be in the past relative to any real run of this suite.
  const violation = checkEventCanBeArchived("2000-01-01");
  assert.equal(violation, null);
});

test("sanitizeEventUpdateFields strips archived on an update (PM or Hub bypass fix)", () => {
  const result = sanitizeEventUpdateFields(
    { topic: "New topic", archived: true },
    true,
  );
  assert.equal(result.archived, undefined);
  assert.equal(result.topic, "New topic");
});

test("sanitizeEventUpdateFields leaves archived alone on creation (no id yet)", () => {
  const result = sanitizeEventUpdateFields(
    { name: "Neues Event", archived: false },
    false,
  );
  assert.equal(result.archived, false);
});

test("sanitizeEventUpdateFields is a no-op when archived isn't present", () => {
  const result = sanitizeEventUpdateFields({ topic: "x" }, true);
  assert.deepEqual(result, { topic: "x" });
});

// ── computeWeeklyDueItems ("Meine Woche" cross-event view) ──
// Fixed "today"/horizon for every test below: today = 2026-06-15,
// horizon = today + 14 days = 2026-06-29 (matches WEEKLY_HORIZON_DAYS).
const WEEK_TODAY = new Date("2026-06-15T00:00:00");
const WEEK_HORIZON_STR = "2026-06-29";

test("computeWeeklyDueItems includes a deeply overdue milestone (mirrors reminders.js's <= catch-up fix, not exact-date matching)", () => {
  // evDate 2026-06-20 → m10w (offset -70) is due 2026-04-11, long overdue.
  const evDate = new Date("2026-06-20T12:00:00");
  const items = computeWeeklyDueItems(
    evDate,
    new Set(),
    new Set(),
    WEEK_HORIZON_STR,
    WEEK_TODAY,
  );
  const m10w = items.find((i) => i.key === "m10w");
  assert.ok(m10w, "expected the overdue m10w milestone to be included");
  assert.ok(
    m10w.days_until_due < 0,
    "an overdue item must have a negative days_until_due",
  );
});

test("computeWeeklyDueItems includes an upcoming item within the horizon with a positive days_until_due", () => {
  // evDate 2026-06-20 → m1d (offset -1) is due 2026-06-19, a few days from
  // "today" (2026-06-15) and well within the 14-day horizon.
  const evDate = new Date("2026-06-20T12:00:00");
  const items = computeWeeklyDueItems(
    evDate,
    new Set(),
    new Set(),
    WEEK_HORIZON_STR,
    WEEK_TODAY,
  );
  const m1d = items.find((i) => i.key === "m1d");
  assert.ok(m1d, "expected the upcoming m1d milestone to be included");
  assert.ok(
    m1d.days_until_due > 0,
    "an upcoming (not-yet-due) item must have a positive days_until_due",
  );
});

test("computeWeeklyDueItems excludes items already marked done", () => {
  const evDate = new Date("2026-06-20T12:00:00");
  const msDone = new Set(["m10w"]);
  const items = computeWeeklyDueItems(
    evDate,
    msDone,
    new Set(),
    WEEK_HORIZON_STR,
    WEEK_TODAY,
  );
  assert.ok(!items.some((i) => i.key === "m10w"));
  // A different, still-open milestone must still show up — done-ness is
  // per-item, not an all-or-nothing switch for the whole event.
  assert.ok(items.some((i) => i.key === "m1d"));
});

test("computeWeeklyDueItems excludes a workflow task once marked done", () => {
  const evDate = new Date("2026-06-20T12:00:00");
  const wfDone = new Set(["pflicht_lo1"]);
  const items = computeWeeklyDueItems(
    evDate,
    new Set(),
    wfDone,
    WEEK_HORIZON_STR,
    WEEK_TODAY,
  );
  assert.ok(!items.some((i) => i.key === "pflicht_lo1"));
});

test("computeWeeklyDueItems excludes items whose due date falls after the horizon", () => {
  // Event far enough in the future that every offset's due date lands well
  // past the 14-day horizon.
  const evDate = new Date("2027-06-20T12:00:00");
  const items = computeWeeklyDueItems(
    evDate,
    new Set(),
    new Set(),
    WEEK_HORIZON_STR,
    WEEK_TODAY,
  );
  assert.deepEqual(items, []);
});

test("computeWeeklyDueItems returns both milestone and workflow task types", () => {
  const evDate = new Date("2026-06-20T12:00:00");
  const items = computeWeeklyDueItems(
    evDate,
    new Set(),
    new Set(),
    WEEK_HORIZON_STR,
    WEEK_TODAY,
  );
  assert.ok(items.some((i) => i.type === "milestone"));
  assert.ok(items.some((i) => i.type === "workflow"));
  // Sanity: every list entry this function knows about should be
  // representable — total count is bounded by the two source lists.
  assert.ok(
    items.length <=
      WEEKLY_MILESTONE_OFFSETS.length + WEEKLY_WORKFLOW_TASKS.length,
  );
});
