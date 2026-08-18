// POST /api/learner/:uuid/unsubscribe
// User сказав `/stop` у боті — не шлемо йому більше повідомлень.
// Ставимо unsubscribed_at (usedа усіма cron endpoints як filter для skip).
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
    // Ідемпотентно — якщо уже unsubscribed, просто повертаємо existing time
    if (rec.unsubscribed_at) {
      return ok(res, { uuid: rec.uuid, unsubscribed_at: rec.unsubscribed_at, already: true });
    }
    const now = nowIso();
    await updateLearner(rec.Id, { unsubscribed_at: now });
    return ok(res, { uuid: rec.uuid, unsubscribed_at: now });
  } catch (e) {
    console.error('POST /api/learner/:uuid/unsubscribe error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
