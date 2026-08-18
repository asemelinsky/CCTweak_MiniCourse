// POST /api/learner/:uuid/upsell-click
// Tracks the click on CTA to the main course in the L7 final-modal.
// Spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/nocodb-schema-spec/#endpoint-3
const {
  handleOptions,
  ok,
  fail,
  getLearnerByUuid,
  updateLearner,
  nowIso,
} = require('../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'missing uuid');

  try {
    const rec = await getLearnerByUuid(uuid);
    if (!rec) return fail(res, 404, 'learner not found');
    await updateLearner(rec.Id, {
      upsell_clicked: true,
      last_activity_at: nowIso(),
    });
    return ok(res, { uuid: rec.uuid, upsell_clicked: true });
  } catch (e) {
    console.error('POST /api/learner/:uuid/upsell-click error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
