const { createClient } = require('@supabase/supabase-js');
const {
  computeWeeklyDueItems,
  WEEKLY_HORIZON_DAYS,
} = require('./api.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Pure: aggregates due/overdue items across every active event into
// per-event groups ready to render into the digest email. Reuses
// computeWeeklyDueItems() — the exact same "Meine Woche" aggregation logic
// from api.js (dev-task-list.md item 6) — rather than re-deriving the
// due-date rule a third time (reminders.js has its own copy for its
// narrower 3-day reminder window; this is the same rule at the wider
// WEEKLY_HORIZON_DAYS window item 6 already established).
//
// Events with nothing due are dropped entirely (no empty groups in the
// email). Items within a group are sorted most-overdue-first, then
// soonest-due; groups themselves are sorted the same way, by their own
// most-urgent item.
function buildDigestGroups(events, msDoneByEvent, wfDoneByEvent, horizonStr, today) {
  const groups = [];
  events.forEach((ev) => {
    if (!ev.event_date) return;
    const evDate = new Date(ev.event_date + 'T12:00:00');
    const items = computeWeeklyDueItems(
      evDate,
      msDoneByEvent[ev.id] || new Set(),
      wfDoneByEvent[ev.id] || new Set(),
      horizonStr,
      today
    );
    if (!items.length) return;
    items.sort((a, b) => a.days_until_due - b.days_until_due);
    groups.push({ event_id: ev.id, event_name: ev.name, items });
  });
  groups.sort((a, b) => a.items[0].days_until_due - b.items[0].days_until_due);
  return groups;
}

// Pure: turns grouped digest data into the actual email HTML — grouped by
// event, sorted by urgency within each group (already sorted by
// buildDigestGroups, this just renders the order it's given). Same plain,
// minimal inline-text tone as reminders.js's existing reminder email.
function buildDigestEmailHtml(groups, horizonDays) {
  if (!groups.length) {
    return `

        📋 Wochenübersicht
        Keine fälligen oder überfälligen Meilensteine/Aufgaben in den nächsten ${horizonDays} Tagen.

        — DBI Event Planner
      `;
  }
  const eventBlocks = groups
    .map((g) => {
      const rows = g.items
        .map((item) => {
          const isOverdue = item.days_until_due < 0;
          const abs = Math.abs(item.days_until_due);
          const rel = isOverdue
            ? `überfällig seit ${abs} Tag${abs === 1 ? '' : 'en'}`
            : item.days_until_due === 0
              ? 'heute fällig'
              : `fällig in ${item.days_until_due} Tag${item.days_until_due === 1 ? '' : 'en'}`;
          return `${item.label} — ${rel} (${item.due_date})`;
        })
        .join('');
      return `${g.event_name}${rows}`;
    })
    .join('');
  return `

      📋 Wochenübersicht – fällige & überfällige Punkte (nächste ${horizonDays} Tage)
      ${eventBlocks}

      — DBI Event Planner
    `;
}

exports.handler = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + WEEKLY_HORIZON_DAYS);
  const horizonStr = horizon.toISOString().split('T')[0];

  const { data: events } = await supabase
    .from('events').select('*').eq('archived', false);
  if (!events?.length) return { statusCode: 200, body: 'No active events' };

  const eventIds = events.map((e) => e.id);
  const [{ data: msRows }, { data: wfRows }] = await Promise.all([
    supabase.from('milestones')
      .select('event_id,ms_key,done_date').in('event_id', eventIds),
    supabase.from('workflow_rows')
      .select('event_id,workflow_id,row_key,done_date').in('event_id', eventIds)
  ]);

  const msDoneByEvent = {};
  (msRows || []).forEach((r) => {
    if (!r.done_date) return;
    if (!msDoneByEvent[r.event_id]) msDoneByEvent[r.event_id] = new Set();
    msDoneByEvent[r.event_id].add(r.ms_key);
  });
  const wfDoneByEvent = {};
  (wfRows || []).forEach((r) => {
    if (!r.done_date) return;
    if (!wfDoneByEvent[r.event_id]) wfDoneByEvent[r.event_id] = new Set();
    wfDoneByEvent[r.event_id].add(r.workflow_id + '_' + r.row_key);
  });

  const groups = buildDigestGroups(events, msDoneByEvent, wfDoneByEvent, horizonStr, today);
  if (!groups.length) return { statusCode: 200, body: 'Nothing due — no digest sent' };

  const html = buildDigestEmailHtml(groups, WEEKLY_HORIZON_DAYS);
  const subject = `📋 DBI Event Planner – Wochenübersicht (${groups.length} Event${groups.length > 1 ? 's' : ''} mit offenen Punkten)`;
  await sendEmail(process.env.HUB_EMAIL, subject, html);

  return { statusCode: 200, body: `Digest sent for ${groups.length} events` };
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

// Exported alongside `handler` purely for unit testing — see digest.test.js.
exports.buildDigestGroups = buildDigestGroups;
exports.buildDigestEmailHtml = buildDigestEmailHtml;
