// GET /api/learner/by-telegram-id/:tid
// Bot lookup: find learner + all enrollments by Telegram user id.
// v2: returns { learner: {...}, enrollments: [{course_slug, uuid, current_lesson, ...}] }
// If a caller expects the v1 shape (single enrollment), it can pick enrollments[0].
const {
  handleOptions, ok, fail,
  getLearnerByTelegramId, listEnrollmentsByLearner, getCourseById,
  serializeEnrollment, requireBearer,
} = require('../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  const tid = req.query && req.query.tid;
  if (!tid) return fail(res, 400, 'missing tid');

  try {
    const learner = await getLearnerByTelegramId(tid);
    if (!learner) return fail(res, 404, 'learner not found');
    const enrollments = await listEnrollmentsByLearner(learner.Id);
    const courses = await Promise.all(enrollments.map(e => getCourseById(e.course_id)));
    const serialized = enrollments.map((e, i) =>
      serializeEnrollment({ enrollment: e, learner, course: courses[i] })
    );
    return ok(res, {
      learner: {
        Id: learner.Id,
        uuid: learner.uuid,
        telegram_id: learner.telegram_id,
        telegram_username: learner.telegram_username,
        telegram_first_name: learner.telegram_first_name,
        child_name: learner.child_name,
        child_age: learner.child_age,
        unsubscribed_at: learner.unsubscribed_at,
      },
      enrollments: serialized,
      // Convenience: primary enrollment (first) for callers that expect single-course shape
      primary: serialized[0] || null,
    });
  } catch (e) {
    console.error('GET /api/learner/by-telegram-id/:tid error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
