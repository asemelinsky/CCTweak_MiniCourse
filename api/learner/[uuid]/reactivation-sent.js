// POST /api/learner/:uuid/reactivation-sent
// Bot alias for reminder-sent?kind=reactivation. Kept for backward-compat
// with a bot version that already calls this path.
const {
  handleOptions, ok, fail,
  getEnrollmentByUuid, updateEnrollment, nowIso, requireBearer,
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
    const now = nowIso();
    await updateEnrollment(enrollment.Id, { reactivation_sent_at: now });
    return ok(res, { uuid: enrollment.uuid, reactivation_sent_at: now });
  } catch (e) {
    console.error('POST /api/learner/:uuid/reactivation-sent error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
