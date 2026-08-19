// POST /api/webhook/[provider] — consolidated webhook dispatcher (v2 schema).
// Routes /api/webhook/monobank and /api/webhook/wayforpay through one function.
//
// Writes to `payments` table + upserts `learners` + `enrollments` via
// recordSuccessfulPayment. Idempotent by invoice_id.

const { handleOptions, ok, fail, setCors, readBody, recordSuccessfulPayment } = require('../_lib');
const monobank = require('../payment/_monobank');
const wayforpay = require('../payment/_wayforpay');

// order_reference format: cctweak-<telegram_id>-<uuid>
function parseReference(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = /^cctweak-(\d+)-(.+)$/.exec(ref);
  if (!m) return null;
  return { telegram_id: +m[1], uuid: m[2], reference: ref, course_slug: 'cctweak' };
}

// ============================================================================
// Monobank handler
// ============================================================================
async function handleMonobank(req, res, payload) {
  const norm = monobank.normalizeWebhook(payload);
  const parsed = parseReference(norm.reference);

  if (!parsed) {
    console.warn('[webhook/monobank] unknown reference:', norm.reference);
    return ok(res, { ignored: true, reason: 'unknown reference format' });
  }

  if (!norm.isSuccess) {
    console.log(`[webhook/monobank] non-success status='${norm.status}' ref=${norm.reference}`);
    return ok(res, { ignored: true, status: norm.status });
  }

  // Server-to-server verify — invoice really exists at Monobank with status=success.
  let verified;
  try { verified = await monobank.checkStatus(norm.transaction_id); }
  catch (e) {
    console.error('[webhook/monobank] checkStatus failed:', e);
    return fail(res, 502, 'upstream verify failed', String(e.message || e));
  }
  if (verified?.status !== 'success') {
    console.warn(`[webhook/monobank] verify mismatch: webhook=success, upstream=${verified?.status}`);
    return ok(res, { ignored: true, reason: 'upstream status mismatch', upstream_status: verified?.status });
  }

  try {
    const result = await recordSuccessfulPayment({
      telegram_id: parsed.telegram_id,
      telegram_first_name: `TG:${parsed.telegram_id}`, // bot fills real name via /bot/create-learner
      course_slug: parsed.course_slug,
      provider: 'monobank',
      invoice_id: norm.transaction_id,
      order_reference: norm.reference,
      amount_uah: norm.amount_uah,
      webhook_payload: payload,
    });
    return ok(res, {
      accepted: true,
      alreadyRecorded: result.alreadyRecorded,
      created: result.created,
      learner_uuid: result.learner?.uuid || null,
      enrollment_uuid: result.enrollment?.uuid || null,
      payment_id: result.payment?.Id || null,
    });
  } catch (e) {
    console.error('[webhook/monobank] recordSuccessfulPayment error:', e);
    return fail(res, 500, 'nocodb error', String(e.message || e));
  }
}

// ============================================================================
// WayForPay handler
// ============================================================================
function sendWfpAck(res, orderReference, extra) {
  setCors(res);
  const ack = wayforpay.buildAck({ orderReference, status: 'accept' });
  const payload = extra ? { ...ack, _debug: extra } : ack;
  res.status(200).json(payload);
}

async function handleWayforpay(req, res, payload) {
  const norm = wayforpay.normalizeWebhook(payload);
  const parsed = parseReference(norm.reference);

  if (!parsed) {
    console.warn('[webhook/wayforpay] unknown reference:', norm.reference);
    return sendWfpAck(res, norm.reference || 'unknown', { ignored: 'unknown reference' });
  }

  const sig = await wayforpay.verifyWebhook(payload);
  if (!sig.verified) {
    console.error(`[webhook/wayforpay] signature INVALID ref=${norm.reference}: ${sig.reason}`);
    return sendWfpAck(res, norm.reference, { signature_error: sig.reason });
  }

  if (!norm.isSuccess) {
    console.log(`[webhook/wayforpay] non-success transactionStatus='${norm.status}' ref=${norm.reference}`);
    return sendWfpAck(res, norm.reference, { ignored_status: norm.status });
  }

  try {
    const result = await recordSuccessfulPayment({
      telegram_id: parsed.telegram_id,
      telegram_first_name: `TG:${parsed.telegram_id}`,
      course_slug: parsed.course_slug,
      provider: 'wayforpay',
      invoice_id: norm.transaction_id,
      order_reference: norm.reference,
      amount_uah: norm.amount_uah,
      webhook_payload: payload,
    });
    return sendWfpAck(res, norm.reference, {
      accepted: true,
      alreadyRecorded: result.alreadyRecorded,
      created: result.created,
      learner_uuid: result.learner?.uuid || null,
      enrollment_uuid: result.enrollment?.uuid || null,
      payment_id: result.payment?.Id || null,
    });
  } catch (e) {
    console.error('[webhook/wayforpay] recordSuccessfulPayment error:', e);
    // Don't ACK — let WFP retry so we can catch transient NocoDB failures.
    return fail(res, 500, 'nocodb error', String(e.message || e));
  }
}

const HANDLERS = { monobank: handleMonobank, wayforpay: handleWayforpay };

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  const provider = (req.query && req.query.provider || '').toLowerCase();
  const handler = HANDLERS[provider];
  if (!handler) return fail(res, 404, `unknown payment provider '${provider}' (valid: ${Object.keys(HANDLERS).join(', ')})`);

  let payload;
  try { payload = await readBody(req); } catch { return fail(res, 400, 'invalid JSON body'); }

  console.log(`[webhook/${provider}] payload:`, JSON.stringify(payload));
  return handler(req, res, payload);
};
