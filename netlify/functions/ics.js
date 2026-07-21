const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MILESTONE_OFFSETS = [
  { key:'m10w', label:'−10W: Anfragen & Vorlauf',   offset:-70 },
  { key:'m8w',  label:'−8W: Pflichtunterlagen',     offset:-56 },
  { key:'m7w',  label:'−7W: Bestätigungen',         offset:-49 },
  { key:'m6w',  label:'−6W: Einladungsversand',     offset:-42 },
  { key:'m4w',  label:'−4W: Reminder',              offset:-28 },
  { key:'m3w',  label:'−3W: Bestätigung I',         offset:-21 },
  { key:'m2w',  label:'−2W: Bestätigung II',        offset:-14 },
  { key:'m1w',  label:'−1W: Catering',              offset:-7  },
  { key:'m1d',  label:'−1T: Letzter Check',         offset:-1  },
];

const WORKFLOW_TASKS = [
  { id:'pflicht',   key:'ag1',  label:'Agenda vollständig',         offset:-56 },
  { id:'pflicht',   key:'ei3',  label:'Datum/Ort/Zeit angeben',     offset:-56 },
  { id:'pflicht',   key:'ei4',  label:'Anmeldelink live',           offset:-49 },
  { id:'pflicht',   key:'ko3',  label:'Fotograf:in angefragt',      offset:-70 },
  { id:'pflicht',   key:'lo1',  label:'Raum bestätigt',             offset:-49 },
  { id:'pflicht',   key:'lo2',  label:'Catering beauftragt',        offset:-49 },
  { id:'pflicht',   key:'lo6',  label:'Badges bestellt',            offset:-28 },
  { id:'einladung', key:'kl3',  label:'Einladung versendet',        offset:-42 },
  { id:'einladung', key:'kl5',  label:'Reminder versendet',         offset:-28 },
  { id:'einladung', key:'kl6',  label:'Bestätigung I versendet',    offset:-21 },
  { id:'einladung', key:'kl7',  label:'Bestätigung II versendet',   offset:-14 },
  { id:'social',    key:'sa4',  label:'Social-Ankündigung live',    offset:-42 },
  { id:'social',    key:'sr3',  label:'Social-Reminder live',       offset:-14 },
  { id:'pixlip',    key:'px6',  label:'Pixlip Anfrage',             offset:-70 },
  { id:'pixlip',    key:'pv2',  label:'Pixlip Druckdaten',          offset:-28 },
];

exports.handler = async (event) => {
  const { token, event: eventId } = event.queryStringParameters || {};
  let ev, milestones = [], workflowRows = [], pmName = null, pmWorkflows = null;

  try {
    if (token) {
      const { data: pm } = await supabase
        .from('pm_tokens').select('*, events(*)')
        .eq('token', token).single();
      if (!pm) return errRes(401, 'Invalid token');
      ev           = pm.events;
      pmName       = pm.pm_name;
      pmWorkflows  = pm.workflow_ids;
    } else if (eventId) {
      const { data } = await supabase
        .from('events').select('*').eq('id', eventId).single();
      if (!data) return errRes(404, 'Event not found');
      ev = data;
    } else {
      return errRes(400, 'Provide token or event param');
    }

    const [msRes, wfRes] = await Promise.all([
      supabase.from('milestones').select('*').eq('event_id', ev.id),
      supabase.from('workflow_rows').select('*').eq('event_id', ev.id)
    ]);
    milestones   = msRes.data || [];
    workflowRows = wfRes.data || [];
  } catch (e) {
    return errRes(500, e.message);
  }

  const eventDate = ev.event_date
    ? new Date(ev.event_date + 'T12:00:00') : null;
  if (!eventDate) return errRes(400, 'No event date set');

  const stamp = new Date().toISOString()
    .replace(/[-:.]/g,'').slice(0,15) + 'Z';

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//DBI Event Planner//DE',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:DBI ${pmName ? pmName + ' – ' : ''}${ev.name || 'Events'}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];

  const addVEvent = (uid, date, title, description) => {
    if (!date) return;
    const nd = new Date(date); nd.setDate(nd.getDate() + 1);
    const ds = d => `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
    const safe = s => (s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;')
      .replace(/,/g,'\\,').replace(/\n/g,'\\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:dbi-${ev.id}-${uid}@eventmaster`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ds(date)}`,
      `DTEND;VALUE=DATE:${ds(nd)}`,
      `SUMMARY:${safe(title)} | ${safe(ev.name || 'DBI')}`,
      `DESCRIPTION:${safe(description)}`,
      'BEGIN:VALARM', 'TRIGGER:-P3D', 'ACTION:DISPLAY',
      `DESCRIPTION:In 3 Tagen fällig: ${safe(title)}`,
      'END:VALARM',
      'TRANSP:TRANSPARENT', 'END:VEVENT'
    );
  };

  // Main event date
  addVEvent('event', eventDate,
    `🎯 EVENT: ${ev.name || 'DBI Event'}`,
    `Eventdatum: ${ev.name}`);

  // Milestones (skip completed ones)
  const msDone = new Set(
    milestones.filter(m => m.done_date).map(m => m.ms_key)
  );
  MILESTONE_OFFSETS.forEach((ms, i) => {
    if (msDone.has(ms.key)) return;
    addVEvent('ms' + i, addDays(eventDate, ms.offset), ms.label,
      `Meilenstein für ${ev.name || ''}`);
  });

  // Workflow tasks (skip completed, filter by PM workflows if token)
  const wfDone = new Set(
    workflowRows.filter(r => r.done_date)
      .map(r => r.workflow_id + '_' + r.row_key)
  );
  WORKFLOW_TASKS.forEach((t, i) => {
    if (pmWorkflows && !pmWorkflows.includes(t.id)) return;
    if (wfDone.has(t.id + '_' + t.key)) return;
    addVEvent('wf' + i, addDays(eventDate, t.offset), t.label,
      `${t.id} → ${ev.name || ''}`);
  });

  lines.push('END:VCALENDAR');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar;charset=utf-8',
      'Content-Disposition':
        `attachment;filename="DBI-${(ev.name||'Event').replace(/\s+/g,'-')}.ics"`,
      'Cache-Control': 'no-cache, max-age=0'
    },
    body: lines.join('\r\n')
  };
};

function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function p(n) { return String(n).padStart(2, '0'); }
function errRes(code, msg) {
  return { statusCode: code,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg }) };
}
