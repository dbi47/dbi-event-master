const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Password comes ONLY from Netlify environment variable — no fallback
const HUB_PW = process.env.HUB_PASSWORD;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: CORS, body: "" };

  // Guard: if env variable is missing, refuse all requests
  if (!HUB_PW)
    return json(500, { error: "Server misconfigured: HUB_PASSWORD not set" });

  const path = event.path.replace("/.netlify/functions/api", "");
  const method = event.httpMethod;
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {}

  function isHub(b) {
    return b.password === HUB_PW;
  }

  async function getPMToken(token) {
    if (!token) return null;
    const { data } = await supabase
      .from("pm_tokens")
      .select("*, events(*)")
      .eq("token", token)
      .single();
    return data;
  }

  try {
    // GET /events — hub gets all events; PM gets their event via token
    if (path === "/events" && method === "GET") {
      const token = event.queryStringParameters?.token;
      if (token) {
        const pm = await getPMToken(token);
        if (!pm) return json(401, { error: "Invalid token" });
        const full = await loadFullEvent(pm.event_id);
        return json(200, { role: "pm", pm_name: pm.pm_name, ...full });
      }
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: "Unauthorized" });
      const { data: events } = await supabase
        .from("events")
        .select("*")
        .eq("archived", false)
        .order("event_date", { ascending: true });
      return json(200, { role: "hub", events: events || [] });
    }

    // GET /event?id=X — full event detail (hub only)
    if (path === "/event" && method === "GET") {
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: "Unauthorized" });
      const id = event.queryStringParameters?.id;
      if (!id) return json(400, { error: "Missing id" });
      return json(200, await loadFullEvent(id));
    }

    // POST /event — create or update event
    if (path === "/event" && method === "POST") {
      const token = body.token;
      const isToken = Boolean(token);
      if (!isHub(body) && !isToken) return json(401, { error: "Unauthorized" });
      const pm = isToken ? await getPMToken(token) : null;
      if (isToken && !pm) return json(401, { error: "Unauthorized" });
      const {
        id,
        password: _pw,
        token: _t,
        ...fields
      } = body.event ? { ...body.event } : { ...body };
      if (isToken && pm && id && pm.event_id !== id)
        return json(403, { error: "Forbidden" });
      const allowed = isToken
        ? [
            "start_date",
            "topic",
            "owner",
            "owner_email",
            "contact_email",
            "phone",
            "hub_contact",
            "room",
            "catering",
            "catering_contact",
            "rasmus",
            "teams",
            "ablage",
            "file_path",
            "archived",
          ]
        : [
            "name",
            "event_date",
            "start_date",
            "size",
            "topic",
            "owner",
            "owner_email",
            "contact_email",
            "phone",
            "hub_contact",
            "room",
            "catering",
            "catering_contact",
            "rasmus",
            "teams",
            "ablage",
            "file_path",
            "archived",
          ];
      const cleanFields = {};
      allowed.forEach((k) => {
        if (fields[k] !== undefined) cleanFields[k] = fields[k];
      });
      if (!isToken && !cleanFields.name) cleanFields.name = "Neues Event";
      let result;
      if (id) {
        result = await supabase
          .from("events")
          .update(cleanFields)
          .eq("id", id)
          .select()
          .single();
      } else {
        result = await supabase
          .from("events")
          .insert(cleanFields)
          .select()
          .single();
      }
      if (result.error) return json(500, { error: result.error.message });
      return json(200, { event: result.data });
    }

    // ── DELETE /event — permanently delete an event and all related data ──
    // Cascades automatically via the foreign key "on delete cascade" set in
    // milestones, workflow_rows, pm_tokens, reminder_log, milestone_todos.
    if (path === "/event" && method === "DELETE") {
      if (!isHub(body)) return json(401, { error: "Unauthorized" });
      const { event_id } = body;
      if (!event_id) return json(400, { error: "Missing event_id" });

      const { error } = await supabase
        .from("events")
        .delete()
        .eq("id", event_id);

      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }
    // ── END DELETE ──────────────────────────────────────────────────────

    // POST /milestone — set done date
    if (path === "/milestone" && method === "POST") {
      const { event_id, ms_key, done_date, token, password } = body;
      if (token) {
        const pm = await getPMToken(token);
        if (!pm || pm.event_id !== event_id)
          return json(403, { error: "Forbidden" });
      } else if (password !== HUB_PW) {
        return json(401, { error: "Unauthorized" });
      }
      const { error } = await supabase
        .from("milestones")
        .upsert(
          { event_id, ms_key, done_date: done_date || null },
          { onConflict: "event_id,ms_key" },
        );
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // ── NEW: POST /milestone-todo — toggle a milestone checklist item ──
    // Body: { event_id, ms_key, todo_index, checked, token?, password? }
    // Both hub and PM can write here — checked state is shared/visible
    // to both sides after a refresh.
    if (path === "/milestone-todo" && method === "POST") {
      const { event_id, ms_key, todo_index, checked, token, password } = body;
      let checkedBy = "hub";
      if (token) {
        const pm = await getPMToken(token);
        if (!pm || pm.event_id !== event_id)
          return json(403, { error: "Forbidden" });
        checkedBy = pm.pm_name || "pm";
      } else if (password !== HUB_PW) {
        return json(401, { error: "Unauthorized" });
      }
      if (
        !event_id ||
        !ms_key ||
        todo_index === undefined ||
        todo_index === null
      )
        return json(400, { error: "Missing fields" });

      const { error } = await supabase.from("milestone_todos").upsert(
        {
          event_id,
          ms_key,
          todo_index,
          checked: Boolean(checked),
          checked_by: checked ? checkedBy : null,
        },
        { onConflict: "event_id,ms_key,todo_index" },
      );
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }
    // ── END NEW ──────────────────────────────────────────────────────────

    // POST /workflow — set input or done date on a workflow row
    if (path === "/workflow" && method === "POST") {
      const {
        event_id,
        workflow_id,
        row_key,
        input_value,
        done_date,
        token,
        password,
      } = body;
      if (token) {
        const pm = await getPMToken(token);
        if (!pm || pm.event_id !== event_id)
          return json(403, { error: "Forbidden" });
        if (!pm.workflow_ids.includes(workflow_id))
          return json(403, { error: "Not your workflow" });
        // If this row has a specific assignee, only they may edit it
        const { data: assignment } = await supabase
          .from("task_assignments")
          .select("pm_token_id")
          .match({ event_id, workflow_id, row_key })
          .maybeSingle();
        if (assignment && assignment.pm_token_id !== pm.id)
          return json(403, { error: "This task is assigned to someone else" });
      } else if (password !== HUB_PW) {
        return json(401, { error: "Unauthorized" });
      }
      const updateData = { event_id, workflow_id, row_key };
      if (input_value !== undefined) updateData.input_value = input_value;
      if (done_date !== undefined) updateData.done_date = done_date || null;
      const { error } = await supabase
        .from("workflow_rows")
        .upsert(updateData, { onConflict: "event_id,workflow_id,row_key" });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // POST /pm-token — generate a PM link (hub only)
    if (path === "/pm-token" && method === "POST") {
      if (!isHub(body)) return json(401, { error: "Unauthorized" });
      const { event_id, pm_name, pm_email, workflow_ids } = body;
      const { data, error } = await supabase
        .from("pm_tokens")
        .insert({
          event_id,
          pm_name,
          pm_email,
          workflow_ids: workflow_ids || ["pflicht"],
        })
        .select()
        .single();
      if (error) return json(500, { error: error.message });
      const site = process.env.SITE_URL || "";
      return json(200, {
        token: data.token,
        link: `${site}/?token=${data.token}`,
        ics_link: `${site}/.netlify/functions/ics?token=${data.token}`,
      });
    }
    // POST /assign-task — assign one specific task row to a PM (hub only)
    if (path === "/assign-task" && method === "POST") {
      if (!isHub(body)) return json(401, { error: "Unauthorized" });
      const { event_id, workflow_id, row_key, pm_token_id } = body;
      if (!event_id || !workflow_id || !row_key)
        return json(400, { error: "Missing fields" });

      if (!pm_token_id) {
        // Unassign — remove any existing assignment for this row
        await supabase
          .from("task_assignments")
          .delete()
          .match({ event_id, workflow_id, row_key });
        return json(200, { ok: true });
      }

      const { error } = await supabase
        .from("task_assignments")
        .upsert(
          { event_id, workflow_id, row_key, pm_token_id },
          { onConflict: "event_id,workflow_id,row_key" },
        );
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // GET /task-assignments?event_id=X — list all task assignments for an event (hub only)
    if (path === "/task-assignments" && method === "GET") {
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: "Unauthorized" });
      const event_id = event.queryStringParameters?.event_id;
      const { data } = await supabase
        .from("task_assignments")
        .select("workflow_id, row_key, pm_token_id, pm_tokens(pm_name)")
        .eq("event_id", event_id);
      return json(200, { assignments: data || [] });
    }
    // GET /pm-tokens?event_id=X — list tokens for event (hub only)
    if (path === "/pm-tokens" && method === "GET") {
      if (event.queryStringParameters?.password !== HUB_PW)
        return json(401, { error: "Unauthorized" });
      const event_id = event.queryStringParameters?.event_id;
      const { data } = await supabase
        .from("pm_tokens")
        .select("id,token,pm_name,pm_email,workflow_ids,created_at")
        .eq("event_id", event_id)
        .order("created_at");
      const site = process.env.SITE_URL || "";
      const tokens = (data || []).map((t) => ({
        ...t,
        link: `${site}/?token=${t.token}`,
        ics_link: `${site}/.netlify/functions/ics?token=${t.token}`,
      }));
      return json(200, { tokens });
    }

    // POST /archive — archive an event (hub only)
    if (path === "/archive" && method === "POST") {
      if (!isHub(body)) return json(401, { error: "Unauthorized" });
      await supabase
        .from("events")
        .update({ archived: true })
        .eq("id", body.event_id);
      return json(200, { ok: true });
    }

    return json(404, { error: "Not found" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

async function loadFullEvent(event_id) {
  const [{ data: ev }, { data: ms }, { data: wf }, { data: ta }, { data: mt }] =
    await Promise.all([
      supabase.from("events").select("*").eq("id", event_id).single(),
      supabase.from("milestones").select("*").eq("event_id", event_id),
      supabase.from("workflow_rows").select("*").eq("event_id", event_id),
      supabase
        .from("task_assignments")
        .select("workflow_id, row_key, pm_token_id")
        .eq("event_id", event_id),
      supabase
        .from("milestone_todos")
        .select("ms_key, todo_index, checked, checked_by")
        .eq("event_id", event_id),
    ]);
  return {
    event: ev,
    milestones: ms || [],
    workflow_rows: wf || [],
    task_assignments: ta || [],
    milestone_todos: mt || [],
  };
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
