// POST /api/learner/:uuid/progress
// Updates learner progress after each beat or lesson completion.
// Spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/nocodb-schema-spec/#endpoint-2
const {
  handleOptions,
  ok,
  fail,
  getLearnerByUuid,
  updateLearner,
  parseJson,
  nowIso,
  readBody,
  serializeLearner,
} = require('../../_lib');

const VALID_LESSONS = new Set(['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'done']);

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  const uuid = req.query && req.query.uuid;
  if (!uuid || typeof uuid !== 'string') return fail(res, 400, 'missing uuid');

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return fail(res, 400, 'invalid JSON body');
  }

  const {
    current_lesson,
    current_beat_index,
    completed_lesson,     // string like "l3" or null
    attempts_delta,       // integer, added to attempts_per_lesson[current_lesson]
    time_spent_delta_sec, // integer, added to time_spent_min[current_lesson] (as minutes)
  } = body || {};

  if (current_lesson && !VALID_LESSONS.has(current_lesson)) {
    return fail(res, 400, `invalid current_lesson: ${current_lesson}`);
  }
  if (completed_lesson && !VALID_LESSONS.has(completed_lesson)) {
    return fail(res, 400, `invalid completed_lesson: ${completed_lesson}`);
  }

  try {
    const rec = await getLearnerByUuid(uuid);
    if (!rec) return fail(res, 404, 'learner not found');

    // Merge state
    const completed = parseJson(rec.completed_lessons, []);
    if (completed_lesson && !completed.includes(completed_lesson)) {
      completed.push(completed_lesson);
    }

    const targetLesson = current_lesson || rec.current_lesson || 'l2';

    const attempts = parseJson(rec.attempts_per_lesson, {});
    if (attempts_delta && Number.isFinite(+attempts_delta)) {
      attempts[targetLesson] = (attempts[targetLesson] || 0) + Math.trunc(+attempts_delta);
    }

    const timeSpent = parseJson(rec.time_spent_min, {});
    if (time_spent_delta_sec && Number.isFinite(+time_spent_delta_sec)) {
      const deltaMin = +time_spent_delta_sec / 60;
      timeSpent[targetLesson] = Math.round(((timeSpent[targetLesson] || 0) + deltaMin) * 100) / 100;
    }

    const patch = {
      last_activity_at: nowIso(),
      completed_lessons: JSON.stringify(completed),
      attempts_per_lesson: JSON.stringify(attempts),
      time_spent_min: JSON.stringify(timeSpent),
    };
    if (current_lesson) patch.current_lesson = current_lesson;
    if (current_beat_index !== undefined && current_beat_index !== null) {
      patch.current_beat_index = Math.trunc(+current_beat_index) || 0;
    }
    // If completed_lesson is L7 or current_lesson is 'done' — mark finished_course_at.
    if (completed_lesson === 'l7' || current_lesson === 'done') {
      if (!rec.finished_course_at) patch.finished_course_at = nowIso();
      patch.current_lesson = 'done';
    }

    await updateLearner(rec.Id, patch);
    // Return the merged view (patched state) without a second fetch.
    const merged = { ...rec, ...patch };
    return ok(res, serializeLearner(merged));
  } catch (e) {
    console.error('POST /api/learner/:uuid/progress error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
