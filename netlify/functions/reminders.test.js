// Dummy env values so requiring reminders.js (which calls createClient() at
// module load) doesn't throw — these tests only exercise the pure
// computeDueTasks() function, never an actual Supabase or email call.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const test = require("node:test");
const assert = require("node:assert/strict");

const { computeDueTasks } = require("./reminders.js");

// Fixed "today" for every test: 2026-06-15. A milestone/task with this
// offset from evDate lands exactly on in3Str ("2026-06-18").
const IN3 = "2026-06-18";

function daysFromIn3(offsetFromIn3) {
  // Returns an event date such that a task with the given `offset` (from
  // MILESTONE_OFFSETS/WORKFLOW_TASKS) would be due `offsetFromIn3` days
  // relative to in3Str, for a task offset of 0 (i.e. evDate itself).
  const d = new Date(IN3 + "T12:00:00");
  d.setDate(d.getDate() + offsetFromIn3);
  return d;
}

test("a milestone due exactly in 3 days is included", () => {
  // m1d has offset -1, so evDate = in3 + 1 day makes it due exactly on in3Str.
  const evDate = daysFromIn3(1);
  const due = computeDueTasks(evDate, new Set(), new Set(), IN3);
  assert.ok(due.some((t) => t.key === "ms_m1d"));
});

test("a milestone already overdue (due before in3Str) is still included — catch-up fix", () => {
  // evDate far enough in the past that m1d's due date is well before in3Str.
  const evDate = daysFromIn3(1 - 10); // due date 10 days before in3Str
  const due = computeDueTasks(evDate, new Set(), new Set(), IN3);
  assert.ok(
    due.some((t) => t.key === "ms_m1d"),
    "overdue task must still be reported, not silently skipped",
  );
});

test("a milestone due more than 3 days out is excluded", () => {
  // evDate far enough in the future that m1d's due date is after in3Str.
  const evDate = daysFromIn3(1 + 10);
  const due = computeDueTasks(evDate, new Set(), new Set(), IN3);
  assert.ok(!due.some((t) => t.key === "ms_m1d"));
});

test("a milestone already marked done is excluded even if due", () => {
  const evDate = daysFromIn3(1);
  const msDone = new Set(["m1d"]);
  const due = computeDueTasks(evDate, msDone, new Set(), IN3);
  assert.ok(!due.some((t) => t.key === "ms_m1d"));
});

test("a workflow task due exactly in 3 days is included", () => {
  // pflicht/ei4 has offset -49.
  const evDate = daysFromIn3(49);
  const due = computeDueTasks(evDate, new Set(), new Set(), IN3);
  assert.ok(due.some((t) => t.key === "wf_pflicht_ei4"));
});

test("a workflow task already done is excluded", () => {
  const evDate = daysFromIn3(49);
  const wfDone = new Set(["pflicht_ei4"]);
  const due = computeDueTasks(evDate, new Set(), wfDone, IN3);
  assert.ok(!due.some((t) => t.key === "wf_pflicht_ei4"));
});

test("returns an empty array when nothing is due", () => {
  // Event far in the future — nothing should be within 3 days yet.
  const evDate = daysFromIn3(1000);
  const due = computeDueTasks(evDate, new Set(), new Set(), IN3);
  assert.deepEqual(due, []);
});
