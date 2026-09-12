// paginateItems() / filterMyWeekItems() / filterActivityEntries() live in
// public/index.html's inline <script> (this app has no build step). Same
// vm-extraction technique as gantt.test.js: pull the pure functions/consts
// they depend on straight out of the real index.html source via
// balanced-bracket slicing, and evaluate them in an isolated vm context.
// None of these touch `document`/`window`, so no DOM mocking is needed.

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

function loadListHelpers() {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"),
    "utf8",
  );
  const code =
    [
      extractBlock(html, "const MILESTONES = [", "[", "]") + ";",
      extractBlock(html, "function paginateItems(items, page, pageSize) {", "{", "}"),
      extractBlock(
        html,
        "function filterMyWeekItems(items, search, urgency) {",
        "{",
        "}",
      ),
      extractBlock(
        html,
        "function filterActivityEntries(entries, search) {",
        "{",
        "}",
      ),
    ].join("\n\n") +
    "\nglobalThis.__listHelpers = { paginateItems, filterMyWeekItems, filterActivityEntries, MILESTONES };";
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "index-html-extracted.js" });
  return sandbox.__listHelpers;
}

const { paginateItems, filterMyWeekItems, filterActivityEntries, MILESTONES } =
  loadListHelpers();

// ── paginateItems ──

test("paginateItems slices out the requested page", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const { pageItems, totalPages, page } = paginateItems(items, 2, 10);
  assert.deepEqual(pageItems, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(totalPages, 3);
  assert.equal(page, 2);
});

test("paginateItems clamps a too-high page number down to the last page", () => {
  const items = Array.from({ length: 5 }, (_, i) => i);
  const { pageItems, totalPages, page } = paginateItems(items, 99, 10);
  assert.deepEqual(pageItems, [0, 1, 2, 3, 4]);
  assert.equal(totalPages, 1);
  assert.equal(page, 1);
});

test("paginateItems clamps a page below 1 up to page 1", () => {
  const items = Array.from({ length: 5 }, (_, i) => i);
  const { page } = paginateItems(items, 0, 10);
  assert.equal(page, 1);
});

test("paginateItems reports exactly 1 total page for an empty list", () => {
  const { pageItems, totalPages } = paginateItems([], 1, 10);
  assert.deepEqual(pageItems, []);
  assert.equal(totalPages, 1);
});

// ── filterMyWeekItems ──

const MW_ITEMS = [
  { label: "−10W: Anfragen", event_name: "Business beim Brötchen", days_until_due: -5 },
  { label: "Agenda vollständig", event_name: "TechTalk 2026", days_until_due: 0 },
  { label: "−1W: Catering", event_name: "TechTalk 2026", days_until_due: 5 },
  { label: "−1T: Letzter Check", event_name: "Gala Abend", days_until_due: 12 },
];

test("filterMyWeekItems matches on the item label", () => {
  const result = filterMyWeekItems(MW_ITEMS, "Catering", "");
  assert.deepEqual(result, [MW_ITEMS[2]]);
});

test("filterMyWeekItems matches on the event name too", () => {
  const result = filterMyWeekItems(MW_ITEMS, "Gala", "");
  assert.deepEqual(result, [MW_ITEMS[3]]);
});

test("filterMyWeekItems search is case-insensitive", () => {
  const result = filterMyWeekItems(MW_ITEMS, "catering", "");
  assert.deepEqual(result, [MW_ITEMS[2]]);
});

test("filterMyWeekItems 'overdue' bucket keeps only negative days_until_due", () => {
  const result = filterMyWeekItems(MW_ITEMS, "", "overdue");
  assert.deepEqual(result, [MW_ITEMS[0]]);
});

test("filterMyWeekItems 'soon' bucket keeps 0-7 days inclusive", () => {
  const result = filterMyWeekItems(MW_ITEMS, "", "soon");
  assert.deepEqual(result, [MW_ITEMS[1], MW_ITEMS[2]]);
});

test("filterMyWeekItems 'upcoming' bucket keeps more than 7 days out", () => {
  const result = filterMyWeekItems(MW_ITEMS, "", "upcoming");
  assert.deepEqual(result, [MW_ITEMS[3]]);
});

test("filterMyWeekItems combines search and urgency (both must match)", () => {
  const result = filterMyWeekItems(MW_ITEMS, "TechTalk", "soon");
  assert.deepEqual(result, [MW_ITEMS[1], MW_ITEMS[2]]);
});

test("filterMyWeekItems returns everything when search and urgency are both empty", () => {
  const result = filterMyWeekItems(MW_ITEMS, "", "");
  assert.deepEqual(result, MW_ITEMS);
});

// ── filterActivityEntries ──

const firstMilestoneKey = MILESTONES[0].key;
const firstMilestoneLabel = MILESTONES[0].label;

const ACTIVITY_ENTRIES = [
  { actor: "greg", milestone_key: firstMilestoneKey, new_done_date: "2026-01-01" },
  { actor: "hub", milestone_key: "not-a-real-key", new_done_date: null },
];

test("filterActivityEntries matches on actor name", () => {
  const result = filterActivityEntries(ACTIVITY_ENTRIES, "greg");
  assert.deepEqual(result, [ACTIVITY_ENTRIES[0]]);
});

test("filterActivityEntries matches on the resolved milestone label", () => {
  const result = filterActivityEntries(
    ACTIVITY_ENTRIES,
    firstMilestoneLabel.slice(0, 4),
  );
  assert.deepEqual(result, [ACTIVITY_ENTRIES[0]]);
});

test("filterActivityEntries falls back to the raw key when no milestone matches (still searchable)", () => {
  const result = filterActivityEntries(ACTIVITY_ENTRIES, "not-a-real-key");
  assert.deepEqual(result, [ACTIVITY_ENTRIES[1]]);
});

test("filterActivityEntries returns every entry when search is empty", () => {
  const result = filterActivityEntries(ACTIVITY_ENTRIES, "");
  assert.deepEqual(result, ACTIVITY_ENTRIES);
});

test("filterActivityEntries returns an empty array when nothing matches", () => {
  const result = filterActivityEntries(ACTIVITY_ENTRIES, "nobody-matches-this");
  assert.deepEqual(result, []);
});
