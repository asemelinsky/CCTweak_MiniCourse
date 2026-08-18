// POST /api/bot/create-learner
// Called by the Telegram bot after payment. Creates a new learner record
// or returns the existing one for the same telegram_id (idempotency).
// Spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/nocodb-schema-spec/#endpoint-4
const {
  handleOptions,
  ok,
  fail,
  insertLearner,
  getLearnerByTelegramId,
  generateUuid,
  nowIso,
  readBody,
  requireBearer,
} = require('../_lib');

const PUBLIC_APP_URL =
  process.env.PUBLIC_APP_URL || 'https://cctweak-minicourse.vercel.app';

const VALID_PROVIDERS = new Set(['telegram_payments', 'monobank_link', 'manual']);

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 400, 'invalid JSON body');
  }

  const {
    telegram_id,
    telegram_username = null,
    telegram_first_name,
    child_name = null,
    child_age = null,
    payment_amount_uah,
    payment_provider,
  } = body || {};

  if (!telegram_id || !Number.isFinite(+telegram_id)) {
    return fail(res, 400, 'telegram_id required (number)');
  }
  if (!telegram_first_name || typeof telegram_first_name !== 'string') {
    return fail(res, 400, 'telegram_first_name required');
  }
  if (!payment_amount_uah || !Number.isFinite(+payment_amount_uah)) {
    return fail(res, 400, 'payment_amount_uah required (number)');
  }
  if (!payment_provider || !VALID_PROVIDERS.has(payment_provider)) {
    return fail(res, 400,
      `payment_provider required (one of ${[...VALID_PROVIDERS].join(', ')})`);
  }

  try {
    // Idempotency: if telegram_id already exists, return existing learner.
    const existing = await getLearnerByTelegramId(+telegram_id);
    if (existing) {
      return ok(res, {
        uuid: existing.uuid,
        learner_url: `${PUBLIC_APP_URL}/?u=${existing.uuid}&lesson=${existing.current_lesson || 'l2'}`,
        existing: true,
      });
    }

    const now = nowIso();
    const uuid = generateUuid();
    const row = {
      uuid,
      telegram_id: +telegram_id,
      telegram_username,
      telegram_first_name,
      child_name,
      child_age: child_age === null ? null : +child_age || null,
      paid_at: now,
      payment_amount_uah: +payment_amount_uah,
      payment_provider,
      current_lesson: 'l2',
      current_beat_index: 0,
      completed_lessons: JSON.stringify(['l1']),
      attempts_per_lesson: '{}',
      time_spent_min: '{}',
      last_activity_at: now,
      upsell_clicked: false,
      created_at: now,
    };
    await insertLearner(row);
    return ok(res, {
      uuid,
      learner_url: `${PUBLIC_APP_URL}/?u=${uuid}&lesson=2`,
      existing: false,
    }, 201);
  } catch (e) {
    console.error('POST /api/bot/create-learner error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
