// GET /api/cron/daily-drip
// Daily cron. Returns learners who:
//   - haven't been active in 20-48 hours
//   - not finished, not unsubscribed, not on 'done'
//   - haven't received a reminder in the last 20 hours
// Spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/nocodb-schema-spec/#endpoint-5
const {
  handleOptions,
  ok,
  fail,
  fetchRecords,
  requireBearer,
} = require('../_lib');

// NocoDB v2 datetime comparison requires format `YYYY-MM-DD HH:MM:SS`
// with a `sub_op` of `exactDate`. Milliseconds and `Z`/`+00:00` suffix are
// rejected with 422 ("is not supported.").
function fmt(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'CRON_SECRET')) return;

  try {
    const now = new Date();
    const t20 = fmt(new Date(now.getTime() - 20 * 3600 * 1000));
    const t48 = fmt(new Date(now.getTime() - 48 * 3600 * 1000));

    // NocoDB v2 `where` DSL: `(field,op,val)~and(field,op,val)~and...`.
    // Nested `((a)~or(b))` groups are unreliable across NocoDB versions, so we
    // apply the "reminder freshness" filter in JS.
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
        // Skip learners already reminded within the last 20h.
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
      if (offset > 5000) break; // safety cap
    }

    return ok(res, { count: results.length, learners: results });
  } catch (e) {
    console.error('GET /api/cron/daily-drip error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
