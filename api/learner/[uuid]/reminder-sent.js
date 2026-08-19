// POST /api/learner/:uuid/reminder-sent
// Bot marks a reminder as delivered. Anti-spam field on enrollment.
// Query: ?kind=daily (default) | reactivation
const {
  handleOptions, ok, fail,
  getEnrollmentByUuid, updateEnrollment, nowIso, requireBearer,
} = require('../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'missing uuid');
  const kind = (req.query && req.query.kind) || 'daily';
  const field = kind === 'reactivation' ? 'reactivation_sent_at' : 'daily_reminder_sent_at';

  try {
    const enrollment = await getEnrollmentByUuid(uuid);
    if (!enrollment) return fail(res, 404, 'learner not found');
    const now = nowIso();
    await updateEnrollment(enrollment.Id, { [field]: now });
    return ok(res, { uuid: enrollment.uuid, [field]: now });
  } catch (e) {
    console.error('POST /api/learner/:uuid/reminder-sent error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
