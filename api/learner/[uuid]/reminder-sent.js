// POST /api/learner/:uuid/reminder-sent
// Called by the Telegram bot after a daily-drip reminder is sent
// to update `daily_reminder_sent_at` so we don't spam. Spec mentions
// this in the Endpoint 5 section.
// Optional query param `?kind=reactivation` updates `reactivation_sent_at` instead.
const {
  handleOptions,
  ok,
  fail,
  getLearnerByUuid,
  updateLearner,
  nowIso,
  requireBearer,
} = require('../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'missing uuid');

  const kind = (req.query && req.query.kind) || 'daily';
  const field =
    kind === 'reactivation' ? 'reactivation_sent_at' : 'daily_reminder_sent_at';

  try {
    const rec = await getLearnerByUuid(uuid);
    if (!rec) return fail(res, 404, 'learner not found');
    const now = nowIso();
    await updateLearner(rec.Id, { [field]: now });
    return ok(res, { uuid: rec.uuid, [field]: now });
  } catch (e) {
    console.error('POST /api/learner/:uuid/reminder-sent error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
