// GET /api/learner/:uuid
// Returns learner state for the web app.
// Spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/nocodb-schema-spec/#endpoint-1
const {
  handleOptions,
  ok,
  fail,
  getLearnerByUuid,
  serializeLearner,
} = require('../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') {
    return fail(res, 400, 'missing uuid');
  }

  try {
    const rec = await getLearnerByUuid(uuid);
    if (!rec) return fail(res, 404, 'learner not found');
    return ok(res, serializeLearner(rec));
  } catch (e) {
    console.error('GET /api/learner/:uuid error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
