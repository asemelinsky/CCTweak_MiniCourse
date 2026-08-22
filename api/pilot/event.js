// POST /api/pilot/event
// Pilot testing telemetry endpoint. Записує подію у NocoDB.pilot_events.
//
// Body: { uuid, event_type, lesson_id?, beat_id?, meta? }
// Response: { ok: true, data: { id } }
//
// Немає auth (публічний ендпоінт для pilot testing з VPS-slug'ів
// mo.skillbridge.pp.ua/<secret>/). Дані — тестові, не критичні,
// UUID придумує викладач на кожну сесію.
//
// CORS дозволено з будь-якого origin (VPS pilot host робить cross-origin fetch).

const {
  handleOptions, ok, fail, readBody, insertRecord,
} = require('../_lib');

const TABLE_PILOT_EVENTS = process.env.NOCODB_TABLE_PILOT_EVENTS_ID || 'ms7z4a29wb5ht9s';

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  let body;
  try { body = await readBody(req); } catch { return fail(res, 400, 'invalid JSON body'); }

  const { uuid, event_type, lesson_id = null, beat_id = null, meta = null } = body || {};

  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'uuid required (string)');
  if (!event_type || typeof event_type !== 'string') return fail(res, 400, 'event_type required (string)');

  const row = {
    learner_uuid: uuid.slice(0, 200),
    event_type: event_type.slice(0, 100),
    lesson_id: lesson_id ? String(lesson_id).slice(0, 20) : null,
    beat_id: beat_id ? String(beat_id).slice(0, 100) : null,
    meta: meta ? JSON.stringify(meta).slice(0, 4000) : null,
  };

  try {
    const created = await insertRecord(TABLE_PILOT_EVENTS, row);
    return ok(res, { id: created.Id || created.id });
  } catch (e) {
    console.error('[pilot/event] insert failed:', e.message);
    return fail(res, 500, 'insert failed: ' + e.message);
  }
};
