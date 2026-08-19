// POST /api/bot/create-learner
// v2: atomic upsert of learner + payment + enrollment. Kept at the original
// path/name so the bot doesn't need any redeploy — response shape is a
// superset of the v1 fields.
//
// Body: {
//   telegram_id, telegram_username?, telegram_first_name,
//   child_name?, child_age?,
//   payment_amount_uah, payment_provider,   // v1 provider values still accepted
//   course_slug?                              // default 'cctweak'
// }
// Response: { uuid, learner_url, existing, learner_uuid, enrollment_uuid, payment_id }
const {
  handleOptions, ok, fail, readBody, requireBearer,
  recordSuccessfulPayment,
} = require('../_lib');

const PUBLIC_APP_URL =
  process.env.PUBLIC_APP_URL || 'https://cctweak-minicourse.vercel.app';

// v1 payment_provider values → v2 provider enum
function mapProvider(v1) {
  if (!v1) return 'manual';
  if (v1 === 'monobank_link' || v1 === 'monobank') return 'monobank';
  if (v1 === 'wayforpay') return 'wayforpay';
  if (v1 === 'telegram_payments') return 'manual';
  if (v1 === 'manual') return 'manual';
  return 'manual';
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  let body;
  try { body = await readBody(req); } catch { return fail(res, 400, 'invalid JSON body'); }

  const {
    telegram_id,
    telegram_username = null,
    telegram_first_name,
    child_name = null,
    child_age = null,
    payment_amount_uah,
    payment_provider,
    course_slug = 'cctweak',
  } = body || {};

  if (!telegram_id || !Number.isFinite(+telegram_id)) return fail(res, 400, 'telegram_id required (number)');
  if (!telegram_first_name || typeof telegram_first_name !== 'string') return fail(res, 400, 'telegram_first_name required');
  if (!payment_amount_uah || !Number.isFinite(+payment_amount_uah)) return fail(res, 400, 'payment_amount_uah required (number)');
  if (!payment_provider) return fail(res, 400, 'payment_provider required');

  try {
    // Synthetic invoice_id for bot-driven manual creates (no payment provider webhook).
    // recordSuccessfulPayment uses this for idempotency by (telegram_id, invoice_id).
    const invoice_id = `bot-create-${telegram_id}-${Date.now()}`;

    const result = await recordSuccessfulPayment({
      telegram_id: +telegram_id,
      telegram_first_name,
      telegram_username,
      child_name,
      child_age,
      course_slug,
      provider: mapProvider(payment_provider),
      invoice_id,
      order_reference: invoice_id,
      amount_uah: +payment_amount_uah,
    });

    const status = result.created.enrollment ? 201 : 200;
    return ok(res, {
      uuid: result.enrollment?.uuid || null,
      learner_url: result.enrollment?.uuid
        ? `${PUBLIC_APP_URL}/?u=${result.enrollment.uuid}&lesson=${result.enrollment.current_lesson || 'l2'}`
        : null,
      existing: !result.created.enrollment,
      learner_uuid: result.learner?.uuid || null,
      enrollment_uuid: result.enrollment?.uuid || null,
      payment_id: result.payment?.Id || null,
    }, status);
  } catch (e) {
    console.error('POST /api/bot/create-learner error:', e);
    return fail(res, 500, 'upstream error', String(e.message || e));
  }
};
