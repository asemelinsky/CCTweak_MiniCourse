// GET /api/cron/reactivation
// Reactivation cron. Returns learners inactive for 5+ days (up to 30 days
// to avoid firing on years-old records) — «Мо сумує!» message.
// Skips: finished, unsubscribed, already reactivated in the last 5 days.
// Spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/nocodb-schema-spec/#endpoint-6
const {
  handleOptions,
  ok,
  fail,
  fetchRecords,
  requireBearer,
} = require('../_lib');

// NocoDB v2 datetime comparison expects `YYYY-MM-DD HH:MM:SS` with sub_op `exactDate`.
function fmt(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'CRON_SECRET')) return;

  try {
    const now = new Date();
    const t5 = fmt(new Date(now.getTime() - 5 * 24 * 3600 * 1000));
    const t30 = fmt(new Date(now.getTime() - 30 * 24 * 3600 * 1000));

    // Apply reactivation-freshness filter in JS (nested OR is unreliable in the DSL).
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
        // Skip learners already reactivated within the last 5 days.
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

    return ok(res, { count: results.length, learners: results });
  } catch (e) {
    console.error('GET /api/cron/reactivation error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
