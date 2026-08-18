// api/_lib.js — shared helpers for cctweak_learners endpoints.
// Files starting with `_` are treated as private by Vercel and not routed.

const NOCODB_URL = process.env.NOCODB_URL || 'https://crm.bajka.pp.ua';
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;
const NOCODB_TABLE_ID = process.env.NOCODB_TABLE_ID;
// Basic Auth for the nginx layer that fronts crm.bajka.pp.ua (separate from
// the NocoDB xc-token). Format: `user:password` in plain text.
const NOCODB_BASIC_AUTH = process.env.NOCODB_BASIC_AUTH;

// -------- HTTP / CORS --------

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(204).end();
    return true;
  }
  return false;
}

function ok(res, data, status = 200) {
  setCors(res);
  res.status(status).json({ ok: true, data });
}

function fail(res, status, message, extra) {
  setCors(res);
  const body = { ok: false, error: message };
  if (extra) body.details = extra;
  res.status(status).json(body);
}

// -------- NocoDB client --------

async function nocodb(path, opts = {}) {
  if (!NOCODB_TOKEN) throw new Error('NOCODB_TOKEN env is not set');
  if (!NOCODB_TABLE_ID && !path.startsWith('/')) {
    throw new Error('NOCODB_TABLE_ID env is not set');
  }
  const url = `${NOCODB_URL}${path}`;
  const headers = {
    'xc-token': NOCODB_TOKEN,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (NOCODB_BASIC_AUTH) {
    headers.Authorization =
      'Basic ' + Buffer.from(NOCODB_BASIC_AUTH).toString('base64');
  }
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`NocoDB ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function fetchRecords(where, opts = {}) {
  const q = new URLSearchParams();
  if (where) q.set('where', where);
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.offset) q.set('offset', String(opts.offset));
  if (opts.fields) q.set('fields', opts.fields);
  const path = `/api/v2/tables/${NOCODB_TABLE_ID}/records?${q.toString()}`;
  return nocodb(path, { method: 'GET' });
}

async function getLearnerByUuid(uuid) {
  const escaped = String(uuid).replace(/[)(,]/g, '');
  const data = await fetchRecords(`(uuid,eq,${escaped})`, { limit: 1 });
  return (data && data.list && data.list[0]) || null;
}

async function getLearnerByTelegramId(telegramId) {
  const data = await fetchRecords(`(telegram_id,eq,${telegramId})`, { limit: 1 });
  return (data && data.list && data.list[0]) || null;
}

async function insertLearner(row) {
  return nocodb(`/api/v2/tables/${NOCODB_TABLE_ID}/records`, {
    method: 'POST',
    body: JSON.stringify(row),
  });
}

async function updateLearner(id, patch) {
  return nocodb(`/api/v2/tables/${NOCODB_TABLE_ID}/records`, {
    method: 'PATCH',
    body: JSON.stringify({ Id: id, ...patch }),
  });
}

// -------- Utilities --------

// Generate uuid in format `abcd-1234-efgh` (12 alphanum chars in 3 groups).
// Uses crypto for randomness.
function generateUuid() {
  const crypto = require('crypto');
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const pickGroup = () => {
    const bytes = crypto.randomBytes(4);
    let out = '';
    for (let i = 0; i < 4; i++) out += chars[bytes[i] % chars.length];
    return out;
  };
  return `${pickGroup()}-${pickGroup()}-${pickGroup()}`;
}

// Safe JSON parse for LongText fields that store JSON strings.
function parseJson(x, fallback) {
  if (x === null || x === undefined || x === '') return fallback;
  if (typeof x === 'object') return x;
  try {
    return JSON.parse(x);
  } catch {
    return fallback;
  }
}

// Format Date to NocoDB-friendly ISO-ish string.
// NocoDB accepts `YYYY-MM-DD HH:MM:SS+00:00` and standard ISO both.
function nowIso() {
  return new Date().toISOString();
}

// Read JSON body robustly regardless of Vercel body parser behavior.
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

// Bearer-token guard. Returns true if authorized, else writes 401 and returns false.
function requireBearer(req, res, envKey) {
  const expected = process.env[envKey];
  if (!expected) return true; // if secret not configured, allow (dev mode)
  const header = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || m[1] !== expected) {
    // Vercel Cron alternative: `x-vercel-cron` header set on scheduled invocations.
    if (envKey === 'CRON_SECRET' && req.headers['x-vercel-cron']) return true;
    fail(res, 401, 'unauthorized');
    return false;
  }
  return true;
}

// Serialize a learner record for the public web-app response.
// Adds `unlocked_lessons` (completed + current) per spec Endpoint 1 sample.
function serializeLearner(rec) {
  if (!rec) return null;
  const completed = parseJson(rec.completed_lessons, []);
  const current = rec.current_lesson || 'l2';
  const unlocked = Array.from(new Set([...completed, ...(current === 'done' ? [] : [current])]));
  return {
    uuid: rec.uuid,
    child_name: rec.child_name || null,
    child_age: rec.child_age || null,
    telegram_first_name: rec.telegram_first_name || null,
    current_lesson: current,
    current_beat_index: rec.current_beat_index || 0,
    completed_lessons: completed,
    unlocked_lessons: unlocked,
    finished_course_at: rec.finished_course_at || null,
    upsell_clicked: !!rec.upsell_clicked,
  };
}

module.exports = {
  setCors,
  handleOptions,
  ok,
  fail,
  nocodb,
  fetchRecords,
  getLearnerByUuid,
  getLearnerByTelegramId,
  insertLearner,
  updateLearner,
  generateUuid,
  parseJson,
  nowIso,
  readBody,
  requireBearer,
  serializeLearner,
};
