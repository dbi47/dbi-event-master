const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WORKFLOW_TASKS = [
  { id:'pflicht',   key:'ag1',  label:'Agenda vollständig',         offset:-56 },
  { id:'pflicht',   key:'ei3',  label:'Datum/Ort angeben',          offset:-56 },
  { id:'pflicht',   key:'ei4',  label:'Anmeldelink live',           offset:-49 },
  { id:'pflicht',   key:'ko3',  label:'Fotograf:in angefragt',      offset:-70 },
  { id:'pflicht',   key:'lo1',  label:'Raum bestätigt',             offset:-49 },
  { id:'pflicht',   key:'lo2',  label:'Catering beauftragt',        offset:-49 },
  { id:'social',    key:'sa4',  label:'Social-Ankündigung live',    offset:-42 },
  { id:'social',    key:'sr3',  label:'Social-Reminder live',       offset:-14 },
  { id:'pixlip',    key:'px6',  label:'Pixlip Anfrage',             offset:-70 },
  { id:'pixlip',    key:'pv5',  label:'Pixlip Druckdaten bestellt', offset:-42 },
  { id:'pixlip',    key:'pv2',  label:'Pixlip Druckdaten erstellt', offset:-28 },
];

const MILESTONE_OFFSETS = [
  { key:'m10w', label:'−10W: Anfragen',        offset:-70 },
  { key:'m8w',  label:'−8W: Pflichtunterlagen',offset:-56 },
  { key:'m7w',  label:'−7W: Bestätigungen',    offset:-49 },
  { key:'m6w',  label:'−6W: Einladungsversand',offset:-42 },
  { key:'m4w',  label:'−4W: Reminder',         offset:-28 },
  { key:'m3w',  label:'−3W: Bestätigung I',    offset:-21 },
  { key:'m2w',  label:'−2W: Bestätigung II',   offset:-14 },
  { key:'m1w',  label:'−1W: Catering',         offset:-7  },
  { key:'m1d',  label:'−1T: Letzter Check',    offset:-1  },
];

// Pure: given an event's date and what's already marked done, returns every
// still-open milestone/workflow task whose deadline falls ON OR BEFORE
// `in3Str` — i.e. due within the next 3 days, or already overdue.
//
// This used to check `due === in3Str` (exactly 3 days out), which meant a
// single missed run of this scheduled function (Netlify hiccup, deploy
// window, etc.) would permanently skip that task's only reminder — the
// window would already be in the past by the next run. Using <= means a
// task keeps showing up as "due" on every subsequent run until it's
// actually been sent, so a missed day just gets caught on the next one
// instead of silently disappearing. The reminder_log dedup in the handler
// is keyed per-task (not per-day) for the same reason — see there.
function computeDueTasks(evDate, msDone, wfDone, in3Str) {
  const dueTasks = [];

  MILESTONE_OFFSETS.forEach((m) => {
    if (msDone.has(m.key)) return;
    const due = addDays(evDate, m.offset).toISOString().split('T')[0];
    if (due <= in3Str) dueTasks.push({ key: 'ms_' + m.key, label: m.label });
  });

  WORKFLOW_TASKS.forEach((t) => {
    if (wfDone.has(t.id + '_' + t.key)) return;
    const due = addDays(evDate, t.offset).toISOString().split('T')[0];
    if (due <= in3Str)
      dueTasks.push({ key: 'wf_' + t.id + '_' + t.key, label: t.label });
  });

  return dueTasks;
}

// PostgREST silently caps any response at 1000 rows and long `.in()` id lists
// can overflow URL limits, so a naive one-shot `.in('event_id', allIds)` would
// quietly return a truncated set once there are enough events — which here
// would read as "task not done / not yet reminded" and fire wrong emails.
// Ids are chunked and each chunk is paged until exhausted. `orderBy` must be a
// total order (unique columns) so paging can't skip or repeat rows. A failed
// read throws instead of returning [] — an empty result would be
// indistinguishable from "nothing done / nothing sent" and re-send everything.
const ID_CHUNK = 100;
const PAGE_SIZE = 1000;
async function fetchByEventIds(table, columns, eventIds, orderBy) {
  const rows = [];
  for (let i = 0; i < eventIds.length; i += ID_CHUNK) {
    const chunk = eventIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = supabase.from(table).select(columns).in('event_id', chunk);
      orderBy.forEach((col) => { q = q.order(col); });
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`reminders: could not read ${table}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

function groupByEvent(rows, pick) {
  const map = {};
  rows.forEach((r) => { (map[r.event_id] ||= []).push(pick(r)); });
  return map;
}

exports.handler = async () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const in3   = new Date(today); in3.setDate(in3.getDate() + 3);
  const in3Str = in3.toISOString().split('T')[0];

  const { data: events } = await supabase
    .from('events').select('*').eq('archived', false);
  if (!events?.length) return { statusCode: 200, body: 'No active events' };

  // Every read the loop below needs, fetched once up front. Undated events are
  // skipped by the loop, so there's no point reading data for them.
  const eventIds = events.filter((e) => e.event_date).map((e) => e.id);
  const [msRows, wfRows, logRows, pmRows] = await Promise.all([
    fetchByEventIds('milestones', 'event_id,ms_key,done_date', eventIds,
      ['event_id', 'ms_key']),
    fetchByEventIds('workflow_rows', 'event_id,workflow_id,row_key,done_date', eventIds,
      ['event_id', 'workflow_id', 'row_key']),
    fetchByEventIds('reminder_log', 'event_id,task_key', eventIds,
      ['event_id', 'task_key']),
    fetchByEventIds('pm_tokens', 'event_id,pm_email,pm_name', eventIds,
      ['event_id', 'created_at']),
  ]);
  const msDoneByEvent = groupByEvent(msRows.filter((r) => r.done_date), (r) => r.ms_key);
  const wfDoneByEvent = groupByEvent(wfRows.filter((r) => r.done_date),
    (r) => r.workflow_id + '_' + r.row_key);
  // A task is reminded ONCE ever per event, not once per calendar day, so
  // dedup is purely "has this task_key already been logged for this event."
  const sentKeysByEvent = groupByEvent(logRows, (r) => r.task_key);
  const pmsByEvent = groupByEvent(pmRows, (p) => p);

  let totalSent = 0;
  // Collected across the whole run and written in one insert after the loop.
  // Written in `finally` so events already emailed before an exception still
  // get logged — same as when each event was logged right after its own send.
  const newLogRows = [];

  try {
  for (const ev of events) {
    if (!ev.event_date) continue;
    const evDate = new Date(ev.event_date + 'T12:00:00');

    const msDone = new Set(msDoneByEvent[ev.id] || []);
    const wfDone = new Set(wfDoneByEvent[ev.id] || []);

    const dueTasks = computeDueTasks(evDate, msDone, wfDone, in3Str);
    if (!dueTasks.length) continue;

    const sentKeys = new Set(sentKeysByEvent[ev.id] || []);
    const toSend   = dueTasks.filter(t => !sentKeys.has(t.key));
    if (!toSend.length) continue;

    // Recipients: hub + all PMs who have an email address
    const recipients = [
      { email: process.env.HUB_EMAIL, name: 'Stephanie' },
      ...(pmsByEvent[ev.id] || []).filter(p=>p.pm_email)
        .map(p=>({ email: p.pm_email, name: p.pm_name }))
    ];

    const evDateStr = new Date(ev.event_date)
      .toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'});
    const subject = `⏰ Anstehende Frist – ${ev.name} (${evDateStr})`;
    const html = `

        ⏰ Erinnerung: anstehende Frist
        Event: ${ev.name} – ${evDateStr}
        Fällig bis spätestens ${in3Str}:

          ${toSend.map(t=>`${t.label}`).join('')}

        — DBI Event Planner
      `;

    for (const r of recipients) {
      await sendEmail(r.email, subject, html);
      totalSent++;
    }

    // Log sent — task_key alone is the dedup key (see sentKeysByEvent above)
    toSend.forEach(t =>
      newLogRows.push({ event_id: ev.id, task_key: t.key, sent_date: in3Str })
    );
  }
  } finally {
    if (newLogRows.length)
      await supabase.from('reminder_log').insert(newLogRows);
  }

  return { statusCode: 200, body: `Sent ${totalSent} reminder emails` };
};

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'DBI Event Planner ',
      to: [to],
      subject,
      html
    })
  });
  return res.json();
}

function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

// Exported alongside `handler` purely for unit testing — see reminders.test.js.
exports.computeDueTasks = computeDueTasks;
exports.WORKFLOW_TASKS = WORKFLOW_TASKS;
exports.MILESTONE_OFFSETS = MILESTONE_OFFSETS;
