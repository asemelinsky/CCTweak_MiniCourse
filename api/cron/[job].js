// GET /api/cron/[job] — consolidated cron dispatcher (v2 schema).
// Vercel cron paths /api/cron/{daily-drip,reactivation,upsell-followup} all route here.
//
// v2: scan `enrollments` (with per-enrollment activity fields), fetch matching
// `learners` in bulk, return the same JSON the bot v1 already consumes.

const {
  handleOptions, ok, fail,
  nocodb, fetchRecords, getLearnerById,
  requireBearer,
  TABLE_ENROLLMENTS, TABLE_LEARNERS,
} = require('../_lib');

// NocoDB v2 datetime comparison: `YYYY-MM-DD HH:MM:SS` with sub_op `exactDate`.
function fmt(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

// Attach learner info (bulk fetch) for the response payload.
async function attachLearners(enrollments) {
  if (!enrollments.length) return [];
  const ids = [...new Set(enrollments.map(e => e.learner_id).filter(Boolean))];
  // Fetch each learner (small batches). NocoDB `in` operator: `(Id,in,1,2,3)`
  const learners = {};
  // Chunk to keep URL short.
  const chunk = 50;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const where = `(Id,in,${slice.join(',')})`;
    const d = await fetchRecords(TABLE_LEARNERS, where, { limit: chunk });
    for (const l of (d.list || [])) learners[l.Id] = l;
  }
  // Skip enrollments whose learner is unsubscribed.
  return enrollments
    .map(e => ({ enrollment: e, learner: learners[e.learner_id] || null }))
    .filter(({ learner }) => learner && !learner.unsubscribed_at);
}

// -------- daily-drip: enrollment inactive 20-48h, not finished, not on 'done' --------
async function dailyDrip() {
  const now = new Date();
  const t20 = fmt(new Date(now.getTime() - 20 * 3600 * 1000));
  const t48 = fmt(new Date(now.getTime() - 48 * 3600 * 1000));

  const where =
    `(last_activity_at,lt,exactDate,${t20})` +
    `~and(last_activity_at,gt,exactDate,${t48})` +
    `~and(finished_at,is,null)` +
    `~and(current_lesson,neq,done)`;

  const enrollments = await fetchAll(TABLE_ENROLLMENTS, where);
  const pairs = await attachLearners(enrollments);

  const results = [];
  for (const { enrollment: e, learner: l } of pairs) {
    if (e.daily_reminder_sent_at) {
      const sent = new Date(e.daily_reminder_sent_at);
      if (sent > new Date(now.getTime() - 20 * 3600 * 1000)) continue;
    }
    results.push({
      uuid: e.uuid,
      telegram_id: l.telegram_id,
      telegram_first_name: l.telegram_first_name,
      child_name: l.child_name,
      current_lesson: e.current_lesson,
      last_activity_at: e.last_activity_at,
    });
  }
  return { count: results.length, learners: results };
}

// -------- reactivation: inactive 5-30d, «Мо сумує!» --------
async function reactivation() {
  const now = new Date();
  const t5 = fmt(new Date(now.getTime() - 5 * 24 * 3600 * 1000));
  const t30 = fmt(new Date(now.getTime() - 30 * 24 * 3600 * 1000));

  const where =
    `(last_activity_at,lt,exactDate,${t5})` +
    `~and(last_activity_at,gt,exactDate,${t30})` +
    `~and(finished_at,is,null)` +
    `~and(current_lesson,neq,done)`;

  const enrollments = await fetchAll(TABLE_ENROLLMENTS, where);
  const pairs = await attachLearners(enrollments);

  const results = [];
  for (const { enrollment: e, learner: l } of pairs) {
    if (e.reactivation_sent_at) {
      const sent = new Date(e.reactivation_sent_at);
      if (sent > new Date(now.getTime() - 5 * 24 * 3600 * 1000)) continue;
    }
    results.push({
      uuid: e.uuid,
      telegram_id: l.telegram_id,
      telegram_first_name: l.telegram_first_name,
      child_name: l.child_name,
      current_lesson: e.current_lesson,
      last_activity_at: e.last_activity_at,
      days_inactive: Math.floor((now - new Date(e.last_activity_at)) / (24 * 3600 * 1000)),
    });
  }
  return { count: results.length, learners: results };
}

// -------- upsell-followup: finished 24-72h ago, no upsell click yet --------
async function upsellFollowup() {
  const now = new Date();
  const t24h = fmt(new Date(now.getTime() - 24 * 3600 * 1000));
  const t72h = fmt(new Date(now.getTime() - 72 * 3600 * 1000));

  const where =
    `(finished_at,lt,exactDate,${t24h})` +
    `~and(finished_at,gt,exactDate,${t72h})` +
    `~and(upsell_clicked,eq,false)`;

  const enrollments = await fetchAll(TABLE_ENROLLMENTS, where);
  const pairs = await attachLearners(enrollments);

  const results = pairs.map(({ enrollment: e, learner: l }) => ({
    uuid: e.uuid,
    telegram_id: l.telegram_id,
    telegram_first_name: l.telegram_first_name,
    child_name: l.child_name,
    finished_course_at: e.finished_at,
    hours_since_finish: Math.floor((now - new Date(e.finished_at)) / (3600 * 1000)),
  }));
  return { count: results.length, learners: results };
}

async function fetchAll(tableId, where) {
  const out = [];
  let offset = 0;
  for (;;) {
    const d = await fetchRecords(tableId, where, { limit: 100, offset });
    const list = d.list || [];
    out.push(...list);
    const info = d.pageInfo;
    if (!info || info.isLastPage || list.length === 0) break;
    offset += list.length;
    if (offset > 5000) break;
  }
  return out;
}

const JOBS = {
  'daily-drip': dailyDrip,
  reactivation,
  'upsell-followup': upsellFollowup,
};

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'CRON_SECRET')) return;

  const job = req.query && req.query.job;
  if (!job || !JOBS[job]) {
    return fail(res, 404, `unknown cron job '${job}' (valid: ${Object.keys(JOBS).join(', ')})`);
  }
  try {
    const data = await JOBS[job]();
    return ok(res, data);
  } catch (e) {
    console.error(`GET /api/cron/${job} error:`, e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
