# DBI Event Master — Implementation Task List

Ordered easy → hard. Work top to bottom; check items off as they land. Each
feature block lists the concrete sub-steps and which file(s) it touches.
Mirrors the client proposal doc (`DBI-Event-Master-Improvement-Proposal.md`)
— numbering matches 1:1.

---

## 1. Search, filter & sort on "All Events"
**Files:** `index.html` (`renderEventGrid`, hub-events page markup)

- [x] Add a search input + filter controls above the event grid (search box,
      date-range filter, Hub/Abteilung dropdown, status filter)
- [x] Add `filterAndSortEvents()` — pure function, filters `allEvents` client-side
      (no backend change needed, data's already loaded)
- [x] Wire search/filter inputs to re-run `renderEventGrid()` on change
- [x] Add a sort control (by date, by name, by progress %)
- [x] Persist last-used filter/sort in a local variable (not required to survive reload)
- [ ] Manual test: filter by department, by date range, search by partial name,
      confirm archive toggle still works alongside filters

---

## 2. Consistent save behavior across the app
**Files:** `index.html` (`setWorkflowInput`, `setWorkflowYesNoReason`, `setWorkflowDone`)

**✅ Decided (client, [date]):** the current implementation *is* the rule —
composite multi-field widgets (Agenda, Service Providers) use explicit Save;
single-value fields (plain text, Ja/Nein, dates) keep autosave-on-blur. No
behavior change needed — this task is now a verification + documentation
pass, not a redesign.

- [x] Audit every save path against that rule (`setWorkflowInput`,
      `setWorkflowYesNoReason`, `setWorkflowDone`, Eventdaten fields) —
      confirm each already matches; this should mostly be a "nothing to fix"
      pass given the rule matches what's already built
- [x] Fix any path found to deviate from the rule (unlikely, but verify) —
      audit found zero deviations, no changes made
- [x] Add a short comment block above `WORKFLOWS`/`PROJ_SECTIONS` stating the
      save-behavior convention, so future additions follow it automatically
      without re-litigating the decision
- [ ] Manual test: confirm no regression on Agenda/Service Providers' existing
      draft+Save behavior

---

## 3. Gantt-ready CSV export — single event
**Files:** `index.html` (new function, likely near `exportEventsCSV`)

**✅ Decided (client, [date]):** Version A only for now (single open event,
no backend changes) — Version B (all events combined, item 7) is deferred
until this is delivered and approved. Milestones render as **phase bars**:
start = previous milestone's date, end = this milestone's date.

- [x] Write `buildGanttRows(eventDetail)` — pure function, returns array of
      `{taskName, startDate, endDate, durationDays, pctComplete, category, status}`
      — pulls from `eventDetail.event.event_date`, `eventDetail.milestones`,
      `eventDetail.workflow_rows`, and each row's offset from `WORKFLOWS`
- [x] Milestone rows: `startDate` = previous milestone's computed date (use
      `vorlauf`/event_date as the start for the very first milestone),
      `endDate` = this milestone's own date, `durationDays` = the gap between
      them — NOT zero-duration markers
- [x] Individual workflow tasks (ag1, ei3, lo1, etc.): keep these as
      zero-duration markers (start = end = due date) nested under their phase,
      using each row's own offset from `WORKFLOWS`/`PROJ_SECTIONS` — not just
      the reminder-curated `WORKFLOW_TASKS` subset
- [x] Write `exportEventGanttCSV()` — reuses the existing CSV-escaping /
      BOM / Blob-download pattern from `exportEventsCSV()`
- [x] Add a "📅 Gantt exportieren" button (Dashboard or Summary tab)
- [ ] Manual test: open the exported CSV in Excel, confirm the phase bars
      render as actual bars (not collapsed points) and % complete shows
      correctly for done items
- [x] Add a unit test for `buildGanttRows()` following the existing pattern in
      `reminders.test.js`/`ics.test.js` (pure function, easy to test in isolation)

---

## 4. Duplicate an existing event
**Files:** `api.js` (new endpoint), `index.html` (new button + handler)

**✅ Decided (client, [date]):** copy Service Providers (`sp-data`) into the
new event; leave Agenda content (`ag-data`) blank, since agenda content is
event-specific and providers often repeat.

- [x] New `api.js` endpoint: `POST /event/duplicate` — takes `event_id`,
      copies the `events` row (new id, reset `event_date`/`archived`), then
      copies `workflow_rows` **excluding** `done_date` (new event starts with
      everything unchecked) and **excluding** the `ag-data` row specifically
      (agenda starts blank) — does NOT copy `milestones` or `pm_tokens` (new
      event needs its own milestone tracking and its own PM links)
- [x] Confirm the `sp-data` row (Service Providers) IS included in the
      workflow_rows copy — this is the one exception to "no done_date, fresh
      start," since the provider list itself should carry over, not just its
      structure
- [x] Add "Duplicate" button/icon on each event card (`renderEventGrid`)
- [x] Prompt for new event name + date before duplicating (reuse existing
      modal/prompt pattern if one exists, otherwise a simple `prompt()` or
      small inline form) — implemented as a `prompt()` for the name only;
      the date is deliberately left for the Eventdaten redirect right after
      (native date picker there beats a second raw-text prompt)
- [x] After duplicate succeeds, select the new event and route to Eventdaten
      so the person can fill in the date/specifics immediately
- [ ] Manual test: duplicate an event with Service Providers + Agenda +
      Pflicht data filled in — confirm Service Providers carries over, Agenda
      comes back empty, milestones start unchecked, and editing the copy
      doesn't affect the original

---

## 5. Visual timeline on the Dashboard
**Files:** `index.html` (`renderDashboard`, new rendering function, CSS)

- [x] Design the timeline component: horizontal row of the 9 milestones +
      today-marker + event-date marker, color-coded to match existing status
      colors (`getStatus()`'s red/amber/green/grey scheme)
- [x] Build `renderMilestoneTimeline(eventDetail)` — reuses `getMilestoneDate`,
      `getStatus`, `MILESTONES` (no new data needed, purely a new rendering
      of data already computed for the existing table)
- [x] Insert above or replacing part of the existing milestone table on the
      Dashboard page
- [x] Responsive check: confirm the timeline degrades sensibly on narrow
      viewports (horizontal scroll, or a stacked/vertical fallback) —
      implemented as horizontal scroll (`.ms-timeline-wrap { overflow-x:
      auto }`), matching the existing `.table-wrap` pattern used everywhere
      else in this app for the same purpose
- [ ] Manual test: confirm visual timeline matches the table's own status
      colors and dates exactly (no drift between the two representations)

---

## 6. "My Week" — cross-event overdue/upcoming view
**Files:** `api.js` (extend or add endpoint), `index.html` (new page)

- [x] New `api.js` endpoint (or extend `/events` GET): for each active event,
      return the list of open milestones/workflow tasks whose due date is
      within N days or overdue — similar shape/logic to `attachMilestoneProgress`,
      but returning the actual due items, not just a percentage
- [x] Reuse the due-date computation logic already proven in
      `reminders.js`'s `computeDueTasks()` — consider extracting it to a
      shared location if both files need the same logic (currently
      duplicated per Netlify function; keep that pattern unless it becomes a
      real maintenance problem) — kept as a duplicated copy in `api.js`
      (`computeWeeklyDueItems`, same `<=`-horizon rule), consistent with the
      existing per-function duplication convention
- [x] New "Meine Woche" page: flat list across all events, sorted by
      urgency, each item linking back to its event
- [x] Add sidebar nav entry (hub-only)
- [ ] Manual test: confirm an overdue item in Event A and a due-in-2-days
      item in Event B both appear, correctly sorted, with correct links

---

## 7. Gantt CSV export — selected events combined

**Files:** api.js (new endpoint), index.html (new selection UI + button)

 - [ ] Depends on item 3's buildGanttRows() logic and item 6's aggregate endpoint groundwork — do this after both
 - [ ] Add a selection mechanism on the "Alle Events" page — checkboxes per card (behind a toggle-able "Auswahlmodus" so the normal view stays uncluttered), plus a "Alle auswählen" convenience option so exporting everything is still just one extra click, not removed as a capability
 New api.js endpoint accepting an explicit list of event_ids (not an implicit "all active events") — returns raw milestone + workflow_row data for exactly those events, in one batched query (.in('id', event_ids), not N+1 per-event fetches)
 Extend buildGanttRows() (or a wrapper) to accept multiple events and prefix each row with its event name, so the combined CSV stays legible
 - [ ] Add a sticky/floating "📅 N Events als Gantt exportieren" button that appears once 1+ events are selected (button is hidden/disabled with zero selected)
 - [ ] Manual test: select 2 of 5 events and export — confirm only those 2 appear in the CSV. Select "Alle auswählen" and export — confirm all active events appear. Confirm archived events are excluded either way unless explicitly viewing/selecting from the archived list.

---

## 8. Basic activity log per event
**Files:** SQL migration, `api.js` (write on key milestone changes), `index.html` (new UI)

**✅ Decided (client, [date]):** log key milestone changes only for now (not
every field edit) — narrower, cleaner scope than a full field-level audit
trail.

- [x] SQL: new `activity_log` table — `event_id, actor (hub or pm name),
      milestone_key, old_done_date, new_done_date, changed_at` — SQL provided
      to the client to run themselves (see chat); not run against their DB
- [x] Add logging calls specifically to the `/milestone` write endpoint in
      `api.js` (not `/event` or `/workflow` — those stay unlogged under this
      narrower scope)
- [x] New UI: an "Activity" panel per event showing milestone check/uncheck
      history, newest first
- [ ] Manual test: check and uncheck a couple of milestones as both Hub and a
      PM, confirm the log correctly attributes each change to the right actor
      and that non-milestone edits (e.g. a plain workflow field) do NOT
      appear in the log

---

## 9. Daily/weekly summary email to Hub
**Files:** new Netlify scheduled function (mirrors `reminders.js`), `api.js` (none)

- [x] New scheduled function `digest.js`, modeled directly on `reminders.js`'s
      structure (same `computeDueTasks`-style pure logic, same `sendEmail`
      pattern via Resend)
- [x] Aggregate due/overdue items across ALL active events (reuse item 6's
      logic if it exists by this point) — `digest.js` imports
      `computeWeeklyDueItems`/`WEEKLY_HORIZON_DAYS` directly from `api.js`
      rather than re-deriving the due-date rule a third time
- [x] Build digest email HTML — grouped by event, sorted by urgency
- [x] Add Netlify scheduled-function config (cron: daily or weekly, per
      client preference) — client chose **daily**, `0 7 * * *` (same time as
      `reminders.js`), added to `netlify.toml`
- [x] Add a unit test for the aggregation logic, following the
      `reminders.test.js` pattern
- [ ] Manual test: trigger manually, confirm email content/formatting looks
      right in an actual inbox (not just literal HTML review)

---

## 10. File attachments
**Files:** SQL migration, `api.js` (new endpoints), `index.html` (upload UI)

- [ ] Decide storage backend: Supabase Storage (natural fit, same project)
      vs. an external bucket (S3, etc.) → confirm with client
- [ ] SQL: new `event_files` table — `event_id, file_name, storage_path,
      uploaded_by, uploaded_at`
- [ ] `api.js`: endpoint(s) for upload (or signed-URL generation), list, and
      delete
- [ ] Frontend: file upload control + file list per event (likely on
      Eventdaten or Summary tab)
- [ ] Access control: confirm PM-token uploads are scoped to their own event
      only, same pattern as everything else in `api.js`
- [ ] Manual test: upload, download, and delete as both Hub and PM roles;
      confirm a PM can't access another event's files via a guessed URL

---

## 11. Fix outgoing email (Resend) — BLOCKED on client / Resend access
**Files:** Netlify env vars, `api.js` (`sendEmail`), `reminders.js`, `digest.js`

**Symptom:** creating a PM access shows "Zugang erstellt, aber E-Mail konnte
nicht gesendet werden". Netlify function log (api, 2026-09-25):
`Could not email PM their link: API key is invalid`.

**Why it's blocked:** we have no Resend access yet — waiting on the client
for the account/API key and the verified sender domain.

- [ ] Get Resend access from the client; create an API key with "Sending
      access"
- [ ] Netlify → Site configuration → Environment variables: set
      `RESEND_API_KEY` (no quotes/spaces, starts with `re_`, enabled for
      Functions), then trigger a new deploy
- [ ] Get the client's verified sender address/domain in Resend
- [ ] All three senders use `from: "DBI Event Planner "` — a display name with
      no email address, which Resend will reject once the key is valid. Replace
      with a single `EMAIL_FROM` env var (`DBI Event Planner <noreply@their-domain>`)
      read by `api.js`, `reminders.js` and `digest.js`
- [ ] Note: `reminders.js` and `digest.js` share the same key and `from`, so
      the daily reminder + digest emails have very likely been failing too —
      re-check them after the fix
- [ ] Manual test: create a PM access with an email → mail arrives with the
      link; trigger reminders/digest once and confirm delivery

---

## 12. Check archived-events list for the 1000-row Supabase cap — not urgent
**Files:** `api.js` (`GET /events?archived=true`), `index.html` (archived view)

- [ ] Check the archived-events list endpoint for the same 1000-row Supabase
      cap issue found and fixed in `reminders.js`/`digest.js`. The archive is
      the one part of this app explicitly designed to grow without pruning, so
      it's the most likely place to eventually hit this same silent-truncation
      risk. Not urgent at current usage (~100 events/year), but worth checking
      proactively before it's large enough to actually matter, given this exact
      bug class was proven (not just theorized) to produce silently wrong
      output rather than a visible error.

---

## Notes
- Item 7 (all-events Gantt export) is **on hold** pending item 3's delivery
  and client approval — don't start it yet.
- Items 3 and 7 share logic — when 7 is greenlit, build on 3's `buildGanttRows()`
  rather than writing the multi-event version from scratch.
- Item 6's aggregate-due-items endpoint is reusable groundwork for item 9's
  digest email — sequencing them in this order avoids duplicate work.
- Follow the existing test pattern (`reminders.test.js`, `ics.test.js`) for
  any new pure logic function — the codebase already has this convention
  established, keep it going.
