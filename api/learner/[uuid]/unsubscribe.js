// POST /api/learner/:uuid/unsubscribe
// /stop у боті — не шлемо йому більше повідомлень. Unsubscribed_at живе
// на learner (не enrollment) — це learner-level opt-out для всіх курсів.
const {
  handleOptions, ok, fail,
  getEnrollmentByUuid, getLearnerById, updateLearner, nowIso, requireBearer,
} = require('../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  const uuid = req.query && req.query.uuid;
  if (!uuid) return fail(res, 400, 'missing uuid');

  try {
    const enrollment = await getEnrollmentByUuid(uuid);
    if (!enrollment) return fail(res, 404, 'learner not found');
    const learner = await getLearnerById(enrollment.learner_id);
    if (!learner) return fail(res, 404, 'learner record missing');
    if (learner.unsubscribed_at) {
      return ok(res, { uuid: enrollment.uuid, unsubscribed_at: learner.unsubscribed_at, already: true });
    }
    const now = nowIso();
    await updateLearner(learner.Id, { unsubscribed_at: now });
    return ok(res, { uuid: enrollment.uuid, unsubscribed_at: now });
  } catch (e) {
    console.error('POST /api/learner/:uuid/unsubscribe error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
