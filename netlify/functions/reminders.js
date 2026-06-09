const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
  { id:'einladung', key:'kl6',  label:'Bestätigung I',              offset:-21 },
  { id:'einladung', key:'kl7',  label:'Bestätigung II',             offset:-14 },
  { id:'social',    key:'sa4',  label:'Social-Ankündigung live',    offset:-42 },
  { id:'social',    key:'sr3',  label:'Social-Reminder live',       offset:-14 },
  { id:'pixlip',    key:'px6',  label:'Pixlip Anfrage',             offset:-70 },
  { id:'pixlip',    key:'pv2',  label:'Pixlip Druckdaten',          offset:-28 },
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

exports.handler = async () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const in3   = new Date(today); in3.setDate(in3.getDate() + 3);
  const in3Str = in3.toISOString().split('T')[0];

  const { data: events } = await supabase
    .from('events').select('*').eq('archived', false);
  if (!events?.length) return { statusCode: 200, body: 'No active events' };

  let totalSent = 0;

  for (const ev of events) {
    if (!ev.event_date) continue;
    const evDate = new Date(ev.event_date + 'T12:00:00');

    const [{ data: ms }, { data: wf }] = await Promise.all([
      supabase.from('milestones')
        .select('ms_key,done_date').eq('event_id', ev.id),
      supabase.from('workflow_rows')
        .select('workflow_id,row_key,done_date').eq('event_id', ev.id)
    ]);
    const msDone = new Set((ms||[]).filter(r=>r.done_date).map(r=>r.ms_key));
    const wfDone = new Set((wf||[]).filter(r=>r.done_date)
      .map(r=>r.workflow_id+'_'+r.row_key));

    const dueTasks = [];

    MILESTONE_OFFSETS.forEach(m => {
      if (msDone.has(m.key)) return;
      const due = addDays(evDate, m.offset).toISOString().split('T')[0];
      if (due === in3Str) dueTasks.push({ key:'ms_'+m.key, label:m.label });
    });

    WORKFLOW_TASKS.forEach(t => {
      if (wfDone.has(t.id+'_'+t.key)) return;
      const due = addDays(evDate, t.offset).toISOString().split('T')[0];
      if (due === in3Str) dueTasks.push({ key:'wf_'+t.id+'_'+t.key, label:t.label });
    });

    if (!dueTasks.length) continue;

    // Check reminder log — avoid sending duplicates
    const { data: alreadySent } = await supabase
      .from('reminder_log').select('task_key')
      .eq('event_id', ev.id).eq('sent_date', in3Str);
    const sentKeys = new Set((alreadySent||[]).map(r=>r.task_key));
    const toSend   = dueTasks.filter(t => !sentKeys.has(t.key));
    if (!toSend.length) continue;

    // Recipients: hub + all PMs who have an email address
    const { data: pmTokens } = await supabase
      .from('pm_tokens').select('pm_email,pm_name').eq('event_id', ev.id);
    const recipients = [
      { email: process.env.HUB_EMAIL, name: 'Stephanie' },
      ...(pmTokens||[]).filter(p=>p.pm_email)
        .map(p=>({ email: p.pm_email, name: p.pm_name }))
    ];

    const evDateStr = new Date(ev.event_date)
      .toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'});
    const subject = `⏰ Frist in 3 Tagen – ${ev.name} (${evDateStr})`;
    const html = `
      
        ⏰ Erinnerung: Frist in 3 Tagen
        Event: ${ev.name} – ${evDateStr}
        Fällig am ${in3Str}:
        
          ${toSend.map(t=>`${t.label}`).join('')}
        
        — DBI Event Planner
      `;

    for (const r of recipients) {
      await sendEmail(r.email, subject, html);
      totalSent++;
    }

    // Log sent so we don't repeat today
    await supabase.from('reminder_log').insert(
      toSend.map(t => ({ event_id: ev.id, task_key: t.key, sent_date: in3Str }))
    );
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
