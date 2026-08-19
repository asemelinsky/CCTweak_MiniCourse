// GET /api/cron/[job] — consolidated cron dispatcher.
// Vercel routes /api/cron/daily-drip, /api/cron/reactivation, /api/cron/upsell-followup
// to this single function via the [job] dynamic segment.
//
// vercel.json cron schedules unchanged — each path resolves here with req.query.job set.
// Handlers use identical NocoDB filter DSL as before; behavior byte-compatible.

const {
  handleOptions,
  ok,
  fail,
  fetchRecords,
  requireBearer,
} = require('../_lib');

// NocoDB v2 datetime comparison: `YYYY-MM-DD HH:MM:SS` with sub_op `exactDate`.
function fmt(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// -------- daily-drip: inactive 20-48h, not finished/unsub, not on 'done' --------
async function dailyDrip() {
  const now = new Date();
  const t20 = fmt(new Date(now.getTime() - 20 * 3600 * 1000));
  const t48 = fmt(new Date(now.getTime() - 48 * 3600 * 1000));

  const where =
    `(last_activity_at,lt,exactDate,${t20})` +
    `~and(last_activity_at,gt,exactDate,${t48})` +
    `~and(finished_course_at,is,null)` +
    `~and(unsubscribed_at,is,null)` +
    `~and(current_lesson,neq,done)`;

  const results = [];
  let offset = 0;
  for (;;) {
    const data = await fetchRecords(where, { limit: 100, offset });
    const list = (data && data.list) || [];
    for (const r of list) {
      if (r.daily_reminder_sent_at) {
        const sent = new Date(r.daily_reminder_sent_at);
        if (sent > new Date(now.getTime() - 20 * 3600 * 1000)) continue;
      }
      results.push({
        uuid: r.uuid,
        telegram_id: r.telegram_id,
        telegram_first_name: r.telegram_first_name,
        child_name: r.child_name,
        current_lesson: r.current_lesson,
        last_activity_at: r.last_activity_at,
      });
    }
    const info = data && data.pageInfo;
    if (!info || info.isLastPage || list.length === 0) break;
    offset += list.length;
    if (offset > 5000) break;
  }
  return { count: results.length, learners: results };
}

// -------- reactivation: inactive 5-30 days, «Мо сумує!» --------
async function reactivation() {
  const now = new Date();
  const t5 = fmt(new Date(now.getTime() - 5 * 24 * 3600 * 1000));
  const t30 = fmt(new Date(now.getTime() - 30 * 24 * 3600 * 1000));

  const where =
    `(last_activity_at,lt,exactDate,${t5})` +
    `~and(last_activity_at,gt,exactDate,${t30})` +
    `~and(finished_course_at,is,null)` +
    `~and(unsubscribed_at,is,null)` +
    `~and(current_lesson,neq,done)`;

  const results = [];
  let offset = 0;
  for (;;) {
    const data = await fetchRecords(where, { limit: 100, offset });
    const list = (data && data.list) || [];
    for (const r of list) {
      if (r.reactivation_sent_at) {
        const sent = new Date(r.reactivation_sent_at);
        if (sent > new Date(now.getTime() - 5 * 24 * 3600 * 1000)) continue;
      }
      results.push({
        uuid: r.uuid,
        telegram_id: r.telegram_id,
        telegram_first_name: r.telegram_first_name,
        child_name: r.child_name,
        current_lesson: r.current_lesson,
        last_activity_at: r.last_activity_at,
        days_inactive: Math.floor(
          (now - new Date(r.last_activity_at)) / (24 * 3600 * 1000)
        ),
      });
    }
    const info = data && data.pageInfo;
    if (!info || info.isLastPage || list.length === 0) break;
    offset += list.length;
    if (offset > 5000) break;
  }
  return { count: results.length, learners: results };
}

// -------- upsell-followup: finished 24-72h ago, no upsell click yet --------
async function upsellFollowup() {
  const now = new Date();
  const t24h = fmt(new Date(now.getTime() - 24 * 3600 * 1000));
  const t72h = fmt(new Date(now.getTime() - 72 * 3600 * 1000));

  const where =
    `(finished_course_at,lt,exactDate,${t24h})` +
    `~and(finished_course_at,gt,exactDate,${t72h})` +
    `~and(upsell_clicked,eq,false)` +
    `~and(unsubscribed_at,is,null)`;

  const results = [];
  let offset = 0;
  for (;;) {
    const data = await fetchRecords(where, { limit: 100, offset });
    const list = (data && data.list) || [];
    for (const r of list) {
      results.push({
        uuid: r.uuid,
        telegram_id: r.telegram_id,
        telegram_first_name: r.telegram_first_name,
        child_name: r.child_name,
        finished_course_at: r.finished_course_at,
        hours_since_finish: Math.floor(
          (now - new Date(r.finished_course_at)) / (3600 * 1000)
        ),
      });
    }
    const info = data && data.pageInfo;
    if (!info || info.isLastPage || list.length === 0) break;
    offset += list.length;
    if (offset > 5000) break;
  }
  return { count: results.length, learners: results };
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
