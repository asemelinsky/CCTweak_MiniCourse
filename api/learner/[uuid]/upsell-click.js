// POST /api/learner/:uuid/upsell-click
// Track click on the final-modal CTA. Field lives on enrollment now.
const {
  handleOptions, ok, fail,
  getEnrollmentByUuid, updateEnrollment, nowIso,
} = require('../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'missing uuid');

  try {
    const enrollment = await getEnrollmentByUuid(uuid);
    if (!enrollment) return fail(res, 404, 'learner not found');
    await updateEnrollment(enrollment.Id, {
      upsell_clicked: true,
      last_activity_at: nowIso(),
    });
    return ok(res, { uuid: enrollment.uuid, upsell_clicked: true });
  } catch (e) {
    console.error('POST /api/learner/:uuid/upsell-click error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
