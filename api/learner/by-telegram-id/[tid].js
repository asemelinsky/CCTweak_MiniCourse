// GET /api/learner/by-telegram-id/:tid
// Bot lookup — знайти learner за Telegram user id (idempotent lookup).
// Використовується bot handlers (F1 /start) щоб визначити чи user уже
// був у системі — і які його статуси.
const {
  handleOptions,
  ok,
  fail,
  getLearnerByTelegramId,
  serializeLearner,
  requireBearer,
} = require('../../../_lib');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  const tid = req.query && req.query.tid;
  if (!tid) return fail(res, 400, 'missing tid');

  // Normalize: telegram_id — numeric у NocoDB, приймаємо як string і не парсимо
  // (getLearnerByTelegramId сам зробить cast у своєму where-clause).
  try {
    const rec = await getLearnerByTelegramId(tid);
    if (!rec) return fail(res, 404, 'learner not found');
    return ok(res, serializeLearner(rec));
  } catch (e) {
    console.error('GET /api/learner/by-telegram-id/:tid error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
