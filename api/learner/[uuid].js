// GET /api/learner/:uuid
// Backward-compatible endpoint — reads enrollment (v2 uuid space) + JOINs learner+course
// and returns the same JSON shape the frontend already consumes.
const {
  handleOptions, ok, fail,
  getEnrollmentByUuid, getLearnerById, getCourseById,
  serializeEnrollment,
} = require('../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'missing uuid');

  try {
    const enrollment = await getEnrollmentByUuid(uuid);
    if (!enrollment) return fail(res, 404, 'learner not found');
    const [learner, course] = await Promise.all([
      getLearnerById(enrollment.learner_id),
      getCourseById(enrollment.course_id),
    ]);
    return ok(res, serializeEnrollment({ enrollment, learner, course }));
  } catch (e) {
    console.error('GET /api/learner/:uuid error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
