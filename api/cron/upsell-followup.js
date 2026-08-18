// GET /api/cron/upsell-followup
// Cron endpoint — знайти learners які закінчили курс 1-3 дні тому,
// не клацнули upsell, не відписались. Для bot: «як тобі курс? спробуй live!»
// Spec: телеграм-бот має нагадати про upsell через N днів після завершення.
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
    // Window: закінчили курс 24-72 години тому
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

    return ok(res, { count: results.length, learners: results });
  } catch (e) {
    console.error('GET /api/cron/upsell-followup error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
