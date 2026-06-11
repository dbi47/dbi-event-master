const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HUB_PW = process.env.HUB_PASSWORD || 'DBI2024';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 200, headers: CORS, body: '' };

  const path   = event.path.replace('/.netlify/functions/api', '');
  const method = event.httpMethod;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  function isHub(b) { return b.password === HUB_PW; }

  async function getPMToken(token) {
    if (!token) return null;
    const { data } = await supabase
      .from('pm_tokens')
      .select('*, events(*)')
      .eq('token', token)
      .single();
    return data;
  }

  try {

    // GET /events — hub gets all events; PM gets their event via token
    if (path === '/events' && method === 'GET') {
      const token = event.queryStringParameters?.token;
      if (token) {
        const pm = await getPMToken(token);
        if (!pm) return json(401, { error: 'Invalid token' });
        const full = await loadFullEvent(pm.event_id);
        return json(200, { role: 'pm', pm_name: pm.pm_name, ...full });
      }
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: 'Unauthorized' });
      const { data: events } = await supabase
        .from('events').select('*').eq('archived', false)
        .order('event_date', { ascending: true });
      return json(200, { role: 'hub', events: events || [] });
    }

    // GET /event?id=X — full event detail (hub only)
    if (path === '/event' && method === 'GET') {
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: 'Unauthorized' });
      const id = event.queryStringParameters?.id;
      if (!id) return json(400, { error: 'Missing id' });
      return json(200, await loadFullEvent(id));
    }

    // POST /event — create or update event (hub only)
    if (path === '/event' && method === 'POST') {
      if (!isHub(body)) return json(401, { error: 'Unauthorized' });
      const { id, password, ...fields } = body.event || body;
      let result;
      if (id) {
        result = await supabase.from('events').update(fields).eq('id', id).select().single();
      } else {
        result = await supabase.from('events').insert(fields).select().single();
      }
      if (result.error) return json(500, { error: result.error.message });
      return json(200, { event: result.data });
    }

    // POST /milestone — set done date
    if (path === '/milestone' && method === 'POST') {
      const { event_id, ms_key, done_date, token, password } = body;
      if (token) {
        const pm = await getPMToken(token);
        if (!pm || pm.event_id !== event_id) return json(403, { error: 'Forbidden' });
      } else if (password !== HUB_PW) {
        return json(401, { error: 'Unauthorized' });
      }
      const { error } = await supabase.from('milestones')
        .upsert({ event_id, ms_key, done_date: done_date || null },
                 { onConflict: 'event_id,ms_key' });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // POST /workflow — set input or done date on a workflow row
    if (path === '/workflow' && method === 'POST') {
      const { event_id, workflow_id, row_key, input_value, done_date, token, password } = body;
      if (token) {
        const pm = await getPMToken(token);
        if (!pm || pm.event_id !== event_id) return json(403, { error: 'Forbidden' });
        if (!pm.workflow_ids.includes(workflow_id))
          return json(403, { error: 'Not your workflow' });
      } else if (password !== HUB_PW) {
        return json(401, { error: 'Unauthorized' });
      }
      const { error } = await supabase.from('workflow_rows')
        .upsert(
          { event_id, workflow_id, row_key,
            input_value: input_value ?? null,
            done_date: done_date || null },
          { onConflict: 'event_id,workflow_id,row_key' }
        );
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // POST /pm-token — generate a PM link (hub only)
    if (path === '/pm-token' && method === 'POST') {
      if (!isHub(body)) return json(401, { error: 'Unauthorized' });
      const { event_id, pm_name, pm_email, workflow_ids } = body;
      const { data, error } = await supabase.from('pm_tokens')
        .insert({ event_id, pm_name, pm_email,
                  workflow_ids: workflow_ids || ['pflicht'] })
        .select().single();
      if (error) return json(500, { error: error.message });
      const site = process.env.SITE_URL || 'https://dbinetlifyapp.netlify.app';
      return json(200, {
        token: data.token,
        link: `${site}/?token=${data.token}`,
        ics_link: `${site}/.netlify/functions/ics?token=${data.token}`
      });
    }

    // GET /pm-tokens?event_id=X — list tokens for event (hub only)
    if (path === '/pm-tokens' && method === 'GET') {
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: 'Unauthorized' });
      const event_id = event.queryStringParameters?.event_id;
      const { data } = await supabase.from('pm_tokens')
        .select('id,token,pm_name,pm_email,workflow_ids,created_at')
        .eq('event_id', event_id).order('created_at');
      const site = process.env.SITE_URL || 'https://dbinetlifyapp.netlify.app';
      const tokens = (data || []).map(t => ({
        ...t,
        link: `${site}/?token=${t.token}`,
        ics_link: `${site}/.netlify/functions/ics?token=${t.token}`
      }));
      return json(200, { tokens });
    }

    // POST /archive — archive an event (hub only)
    if (path === '/archive' && method === 'POST') {
      if (!isHub(body)) return json(401, { error: 'Unauthorized' });
      await supabase.from('events').update({ archived: true }).eq('id', body.event_id);
      return json(200, { ok: true });
    }

    return json(404, { error: 'Not found' });

  } catch (err) {
    return json(500, { error: err.message });
  }
};

async function loadFullEvent(event_id) {
  const [{ data: ev }, { data: ms }, { data: wf }] = await Promise.all([
    supabase.from('events').select('*').eq('id', event_id).single(),
    supabase.from('milestones').select('*').eq('event_id', event_id),
    supabase.from('workflow_rows').select('*').eq('event_id', event_id)
  ]);
  return { event: ev, milestones: ms || [], workflow_rows: wf || [] };
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
