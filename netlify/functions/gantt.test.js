// buildGanttRows() lives in public/index.html's inline <script> (this app has
// no build step, so there's nowhere else for client-side logic to live). To
// unit-test it without dragging in a DOM, this file extracts just the pure
// data/logic blocks it depends on — MILESTONES, getMilestoneDate, getStatus,
// addDays, parseISO, daysDiff, TODAY, WORKFLOWS, PROJ_SECTIONS,
// buildGanttRows itself — straight out of the real index.html source (via
// balanced-bracket slicing, not a copy/paste duplicate) and evaluates them in
// an isolated vm context. None of these blocks touch `document`/`window`, so
// no DOM mocking is needed. If any of these names are ever renamed or
// restructured in index.html, this file's extraction will throw a clear
// "marker not found" error rather than silently testing stale logic.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function extractBlock(source, marker, openChar, closeChar) {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`marker not found: ${JSON.stringify(marker)}`);
  const openIdx = source.indexOf(openChar, idx);
  let depth = 0;
  let i = openIdx;
  for (; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return source.slice(idx, i);
}

function loadGanttLogic() {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "index.html"),
    "utf8",
  );
  const code =
    [
      extractBlock(html, "function daysDiff(t) {", "{", "}"),
      extractBlock(html, "const TODAY = () => {", "{", "}") + ";",
      extractBlock(html, "function addDays(d, n) {", "{", "}"),
      extractBlock(html, "function parseISO(s) {", "{", "}"),
      extractBlock(html, "function getStatus(fd, done) {", "{", "}"),
      extractBlock(html, "const MILESTONES = [", "[", "]") + ";",
      extractBlock(
        html,
        "function getMilestoneDate(ms, evDate, sizeWeeks) {",
        "{",
        "}",
      ),
      extractBlock(html, "const WORKFLOWS = {", "{", "}") + ";",
      extractBlock(html, "const PROJ_SECTIONS = [", "[", "]") + ";",
      extractBlock(html, "function buildGanttRows(eventDetail) {", "{", "}"),
    ].join("\n\n") +
    "\nglobalThis.__gantt = { buildGanttRows, MILESTONES, getStatus, getMilestoneDate };";
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "index-html-extracted.js" });
  return sandbox.__gantt;
}

const { buildGanttRows } = loadGanttLogic();

function isoDate(offsetDaysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDaysFromToday);
  return d.toISOString().slice(0, 10);
}

test("returns no rows when the event has no date", () => {
  const rows = buildGanttRows({ event: { event_date: null }, milestones: [], workflow_rows: [] });
  // Not assert.deepEqual(rows, []) — buildGanttRows executes inside an
  // isolated vm context (see loadGanttLogic() above), so the returned array
  // is an Array from that context's own realm. Node's deepEqual compares
  // prototypes too, and a cross-realm Array fails that check even when
  // empty — so assert on length instead of structural equality.
  assert.equal(rows.length, 0);
});

test("milestones render as phase bars, not zero-duration points", () => {
  // Event far enough in the future that every milestone/task offset lands
  // before today's date isn't relevant here — we only check date ranges.
  const rows = buildGanttRows({
    event: { event_date: isoDate(100), size: "12" },
    milestones: [],
    workflow_rows: [],
  });
  const milestoneRows = rows.filter((r) => r.category === "Meilenstein");
  assert.ok(milestoneRows.length > 1, "expected multiple milestone rows");
  // The very first milestone (the lead-time anchor) has no predecessor, so
  // it's a zero-duration anchor point — but every milestone AFTER it must
  // span a real range (start !== end), since it's a phase bar.
  const laterMilestones = milestoneRows.slice(1);
  assert.ok(laterMilestones.length > 0);
  laterMilestones.forEach((r) => {
    assert.notEqual(
      r.startDate.getTime(),
      r.endDate.getTime(),
      `milestone "${r.taskName}" must be a date range, not a point`,
    );
    assert.ok(r.durationDays > 0);
    // Each phase bar's start must equal the previous milestone's own end date.
  });
  for (let i = 1; i < milestoneRows.length; i++) {
    assert.equal(
      milestoneRows[i].startDate.getTime(),
      milestoneRows[i - 1].endDate.getTime(),
      "each milestone's start must be the previous milestone's own date",
    );
  }
});

test("individual workflow tasks render as zero-duration point markers", () => {
  const rows = buildGanttRows({
    event: { event_date: isoDate(100), size: "12" },
    milestones: [],
    workflow_rows: [],
  });
  const taskRows = rows.filter((r) => r.category !== "Meilenstein");
  assert.ok(taskRows.length > 0, "expected individual workflow task rows");
  taskRows.forEach((r) => {
    assert.equal(r.startDate.getTime(), r.endDate.getTime());
    assert.equal(r.durationDays, 0);
  });
});

test("a row shared between WORKFLOWS.pflicht and PROJ_SECTIONS (ag1) is not duplicated", () => {
  const rows = buildGanttRows({
    event: { event_date: isoDate(100), size: "12" },
    milestones: [],
    workflow_rows: [],
  });
  const ag1Rows = rows.filter(
    (r) => r.taskName === "Agenda vollständig (kein tbc!)" || r.taskName === "Agenda vollständig",
  );
  assert.equal(
    ag1Rows.length,
    1,
    "pflicht:ag1 is saved once in the backend and must appear once in the Gantt export",
  );
});

test("a milestone with a done_date shows 100% complete; an open one shows 0%", () => {
  const rows = buildGanttRows({
    event: { event_date: isoDate(200), size: "12" },
    milestones: [{ ms_key: "m10w", done_date: isoDate(-1) }],
    workflow_rows: [],
  });
  const done = rows.find((r) => r.taskName.includes("Anfragen & Vorlauf"));
  const open = rows.find((r) => r.taskName.includes("Pflichtunterlagen"));
  assert.equal(done.pctComplete, 100);
  assert.equal(open.pctComplete, 0);
});

test("a workflow task with a done_date shows 100% complete and an overdue open task shows red/critical status", () => {
  const rows = buildGanttRows({
    // Event date already in the past for several offsets, so at least one
    // task's due date has already passed.
    event: { event_date: isoDate(-100), size: "12" },
    milestones: [],
    workflow_rows: [{ workflow_id: "pflicht", row_key: "ei4", done_date: isoDate(-90) }],
  });
  const doneTask = rows.find((r) => r.taskName === "Anmeldelink");
  assert.equal(doneTask.pctComplete, 100);
  const overdueTask = rows.find(
    (r) => r.taskName === "Einladungstitel" && r.pctComplete === 0,
  );
  assert.ok(overdueTask, "expected an open, overdue workflow task");
  assert.ok(
    ["Überschritten", "Kritisch"].includes(overdueTask.status),
    `expected an overdue/critical status, got "${overdueTask.status}"`,
  );
});

test("a pixlip date_pair row (px2/px3) produces two separate point markers", () => {
  const rows = buildGanttRows({
    event: { event_date: isoDate(100), size: "12" },
    milestones: [],
    workflow_rows: [],
  });
  const buildTask = rows.find((r) => r.taskName === "Aufbaudatum");
  const returnTask = rows.find((r) => r.taskName === "Rückgabedatum");
  assert.ok(buildTask, "expected the date_pair's primary label as its own row");
  assert.ok(returnTask, "expected the date_pair's pairLabel as its own row");
  assert.equal(buildTask.durationDays, 0);
  assert.equal(returnTask.durationDays, 0);
});
