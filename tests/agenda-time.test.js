// parseDotTimeToMinutes() lives in public/index.html's inline <script> (this
// app has no build step). Same vm-extraction technique as
// list-helpers.test.js: pull the pure function straight out of the real
// index.html source and evaluate it in an isolated vm context. It touches no
// `document`/`window`, so no DOM mocking is needed.

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

function loadParseDotTimeToMinutes() {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"),
    "utf8",
  );
  const code =
    extractBlock(
      html,
      "function parseDotTimeToMinutes(t) {",
      "{",
      "}",
    ) +
    "\nglobalThis.__agendaTime = { parseDotTimeToMinutes };";
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "index-html-extracted.js" });
  return sandbox.__agendaTime;
}

const { parseDotTimeToMinutes } = loadParseDotTimeToMinutes();

test("parseDotTimeToMinutes parses a normal HH.MM time", () => {
  assert.equal(parseDotTimeToMinutes("09.00"), 540);
  assert.equal(parseDotTimeToMinutes("09.30"), 570);
  assert.equal(parseDotTimeToMinutes("00.00"), 0);
  assert.equal(parseDotTimeToMinutes("23.59"), 1439);
});

test("parseDotTimeToMinutes trims surrounding whitespace", () => {
  assert.equal(parseDotTimeToMinutes("  09.00  "), 540);
});

test("parseDotTimeToMinutes returns null for empty/unset input", () => {
  assert.equal(parseDotTimeToMinutes(""), null);
  assert.equal(parseDotTimeToMinutes(null), null);
  assert.equal(parseDotTimeToMinutes(undefined), null);
});

test("parseDotTimeToMinutes returns null for malformed input rather than throwing", () => {
  assert.equal(parseDotTimeToMinutes("not a time"), null);
  assert.equal(parseDotTimeToMinutes("09:00"), null); // colon, not dot
  assert.equal(parseDotTimeToMinutes("9"), null);
  assert.equal(parseDotTimeToMinutes("09."), null);
});

test("parseDotTimeToMinutes returns null for out-of-range hours/minutes", () => {
  assert.equal(parseDotTimeToMinutes("24.00"), null);
  assert.equal(parseDotTimeToMinutes("09.60"), null);
});
