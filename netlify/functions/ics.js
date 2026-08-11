const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MILESTONE_OFFSETS = [
  { key: "m10w", label: "-10W: Anfragen & Vorlauf", offset: -70 },
  { key: "m8w", label: "-8W: Pflichtunterlagen", offset: -56 },
  { key: "m7w", label: "-7W: Bestätigungen", offset: -49 },
  { key: "m6w", label: "-6W: Einladungsversand", offset: -42 },
  { key: "m4w", label: "-4W: Reminder", offset: -28 },
  { key: "m3w", label: "-3W: Bestätigung I", offset: -21 },
  { key: "m2w", label: "-2W: Bestätigung II", offset: -14 },
  { key: "m1w", label: "-1W: Catering", offset: -7 },
  { key: "m1d", label: "-1T: Letzter Check", offset: -1 },
];

const WORKFLOW_TASKS = [
  { id: "pflicht", key: "ag1", label: "Agenda vollständig", offset: -56 },
  { id: "pflicht", key: "ei3", label: "Datum/Ort/Zeit angeben", offset: -56 },
  { id: "pflicht", key: "ei4", label: "Anmeldelink live", offset: -49 },
  { id: "pflicht", key: "ko3", label: "Fotograf:in angefragt", offset: -70 },
  { id: "pflicht", key: "lo1", label: "Raum bestätigt", offset: -49 },
  { id: "pflicht", key: "lo2", label: "Catering beauftragt", offset: -49 },
  { id: "pflicht", key: "lo6", label: "Badges bestellt", offset: -28 },
  { id: "einladung", key: "kl3", label: "Einladung versendet", offset: -42 },
  { id: "einladung", key: "kl5", label: "Reminder versendet", offset: -28 },
  {
    id: "einladung",
    key: "kl6",
    label: "Bestätigung I versendet",
    offset: -21,
  },
  {
    id: "einladung",
    key: "kl7",
    label: "Bestätigung II versendet",
    offset: -14,
  },
  { id: "social", key: "sa4", label: "Social-Ankündigung live", offset: -42 },
  { id: "social", key: "sr3", label: "Social-Reminder live", offset: -14 },
  { id: "pixlip", key: "px6", label: "Pixlip Anfrage", offset: -70 },
  { id: "pixlip", key: "pv2", label: "Pixlip Druckdaten", offset: -28 },
];

const RESPONSE_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  "Content-Disposition": 'inline; filename="calendar.ics"',
  "Cache-Control": "public, max-age=300, must-revalidate",
  "Access-Control-Allow-Origin": "*",
  Pragma: "no-cache",
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^
