// Dummy env values so requiring ics.js (which calls createClient() at module
// load) doesn't throw — these tests only exercise the pure text helpers,
// never an actual Supabase call.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const test = require("node:test");
const assert = require("node:assert/strict");

const { foldLine, cleanText, safe, ds } = require("./ics.js");

test("foldLine leaves short lines untouched", () => {
  assert.equal(foldLine("SUMMARY:short"), "SUMMARY:short");
});

test("foldLine wraps a line longer than 75 chars per RFC 5545", () => {
  const long = "SUMMARY:" + "x".repeat(100);
  const folded = foldLine(long);
  const segments = folded.split("\r\n");
  assert.ok(segments.length > 1, "must be split into multiple segments");
  assert.ok(segments[0].length <= 75);
  // Every continuation line after the first must start with a single space
  // (RFC 5545 folding rule) and stay within the 75-char limit including it.
  segments.slice(1).forEach((seg) => {
    assert.ok(seg.startsWith(" "));
    assert.ok(seg.length <= 75);
  });
});

test("cleanText strips accents down to their base ASCII letters", () => {
  assert.equal(cleanText("Bestätigung"), "Bestatigung");
  // ß doesn't decompose under NFKD, so it survives accent-stripping but is
  // then dropped entirely by the final non-ASCII cleanup.
  assert.equal(cleanText("Grüße"), "Grue");
});

test("cleanText normalizes dash variants to a plain hyphen", () => {
  assert.equal(cleanText("2026–01–01"), "2026-01-01");
  assert.equal(cleanText("a—b"), "a-b");
  assert.equal(cleanText("a−b"), "a-b");
});

test("cleanText normalizes the closing curly quote to a straight one", () => {
  // Note: only the closing curly quote (”) is mapped to a straight quote —
  // the opening one (“) isn't in that character class, so it's simply
  // dropped by the final non-ASCII cleanup instead. Pre-existing behavior,
  // documented here rather than "fixed" since other code may already rely
  // on it (e.g. calendar invite text formatting).
  assert.equal(cleanText("“Titel”"), 'Titel"');
  assert.equal(cleanText("it’s"), "it's");
});

test("cleanText drops any remaining non-ASCII characters and trims", () => {
  assert.equal(cleanText("  emoji 🎯 text  "), "emoji  text");
});

test("cleanText handles null/undefined/empty input", () => {
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText(""), "");
});

test("safe escapes ICS special characters after cleaning", () => {
  assert.equal(safe("A, B; C\\D"), "A\\, B\\; C\\\\D");
});

test("safe escapes embedded newlines", () => {
  assert.equal(safe("line1\nline2"), "line1\\nline2");
});

test("safe applies cleanText's accent/dash/quote normalization too", () => {
  assert.equal(safe("Prüfung – Frist"), "Prufung - Frist");
});

test("ds formats a date as YYYYMMDD, zero-padded", () => {
  const d = new Date(2026, 0, 5); // Jan 5, 2026 (month is 0-indexed)
  assert.equal(ds(d), "20260105");
});

test("ds pads single-digit month and day", () => {
  const d = new Date(2026, 8, 9); // Sep 9, 2026
  assert.equal(ds(d), "20260909");
});
