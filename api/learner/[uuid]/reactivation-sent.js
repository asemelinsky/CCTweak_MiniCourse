// POST /api/learner/:uuid/reactivation-sent
// Дублікат `reminder-sent?kind=reactivation` для явного bot use.
// Bot викликає після успішного надсилання reactivation-повідомлення.
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
  if (!uuid) return fail(res, 400, 'missing uuid');

  try {
    const rec = await getLearnerByUuid(uuid);
    if (!rec) return fail(res, 404, 'learner not found');
    const now = nowIso();
    await updateLearner(rec.Id, { reactivation_sent_at: now });
    return ok(res, { uuid: rec.uuid, reactivation_sent_at: now });
  } catch (e) {
    console.error('POST /api/learner/:uuid/reactivation-sent error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
