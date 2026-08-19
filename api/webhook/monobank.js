// POST /api/webhook/monobank
// Monobank Acquiring webhook receiver.
//
// Monobank sends the payment status update to whatever webHookUrl we passed
// when creating the invoice. Status stream includes intermediate values
// (created / processing / hold) — we act only on `success`. All other statuses
// are logged and ACK'd 200 so Monobank doesn't retry.
//
// Idempotency: markLearnerPaid checks notes for `txn=<invoiceId>` and no-ops on repeat.
//
// Verification strategy: instead of signature-verifying the raw body (Monobank uses
// ECDSA + rotating public key), we re-fetch the invoice status server-to-server
// via /merchant/invoice/status?invoiceId=... using our own MONOBANK_MERCHANT_TOKEN.
// A forged webhook would fail this check because we look up the invoice at Monobank.

const { handleOptions, ok, fail, readBody, markLearnerPaid } = require('../_lib');
const monobank = require('../payment/_monobank');

function parseReference(ref) {
  // Format: cctweak-<telegram_id>-<uuid>
  if (!ref || typeof ref !== 'string') return null;
  const m = /^cctweak-(\d+)-(.+)$/.exec(ref);
  if (!m) return null;
  return { telegram_id: +m[1], uuid: m[2], reference: ref };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  let payload;
  try { payload = await readBody(req); } catch { return fail(res, 400, 'invalid JSON body'); }

  console.log('[webhook/monobank] payload:', JSON.stringify(payload));

  const norm = monobank.normalizeWebhook(payload);
  const parsed = parseReference(norm.reference);

  if (!parsed) {
    // Unrecognized reference — probably not our invoice. ACK to stop retries.
    console.warn('[webhook/monobank] unknown reference:', norm.reference);
    return ok(res, { ignored: true, reason: 'unknown reference format' });
  }

  if (!norm.isSuccess) {
    // Intermediate / failure status — just log & ACK.
    console.log(`[webhook/monobank] non-success status='${norm.status}' ref=${norm.reference}`);
    return ok(res, { ignored: true, status: norm.status });
  }

  // Server-to-server verification: fetch invoice status directly from Monobank.
  let verified;
  try {
    verified = await monobank.checkStatus(norm.transaction_id);
  } catch (e) {
    console.error('[webhook/monobank] checkStatus failed:', e);
    return fail(res, 502, 'upstream verify failed', String(e.message || e));
  }
  if (verified?.status !== 'success') {
    console.warn(`[webhook/monobank] verify mismatch: webhook=success, upstream=${verified?.status}`);
    return ok(res, { ignored: true, reason: 'upstream status mismatch', upstream_status: verified?.status });
  }

  try {
    const result = await markLearnerPaid({
      telegram_id: parsed.telegram_id,
      telegram_first_name: `TG:${parsed.telegram_id}`, // placeholder — bot writes real name via create-learner
      payment_amount_uah: norm.amount_uah,
      payment_provider: monobank.NOCODB_PROVIDER_VALUE,
      transaction_id: norm.transaction_id,
      reference: norm.reference,
    });
    return ok(res, {
      accepted: true,
      created: result.created,
      alreadyPaid: result.alreadyPaid,
      uuid: result.learner?.uuid || null,
    });
  } catch (e) {
    console.error('[webhook/monobank] markLearnerPaid error:', e);
    return fail(res, 500, 'nocodb error', String(e.message || e));
  }
};
