// POST /api/webhook/wayforpay
// WayForPay Service URL (callback) receiver.
//
// WayForPay sends `transactionStatus` callbacks on payment lifecycle events. We
// act only on `Approved`. Response MUST be a JSON with orderReference + status +
// time + signature — otherwise WayForPay keeps retrying every few minutes.
//
// Signature verification: HMAC-MD5 over
//   merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode
// with WAYFORPAY_SECRET_KEY. Reject if it doesn't match.

const { handleOptions, ok, fail, setCors, readBody, markLearnerPaid } = require('../_lib');
const wayforpay = require('../payment/_wayforpay');

function parseReference(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = /^cctweak-(\d+)-(.+)$/.exec(ref);
  if (!m) return null;
  return { telegram_id: +m[1], uuid: m[2], reference: ref };
}

// Send the WayForPay-shaped ACK. Always 200 so they stop retrying.
function sendAck(res, orderReference, extra) {
  setCors(res);
  const ack = wayforpay.buildAck({ orderReference, status: 'accept' });
  const payload = extra ? { ...ack, _debug: extra } : ack;
  res.status(200).json(payload);
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

  let payload;
  try { payload = await readBody(req); } catch { return fail(res, 400, 'invalid JSON body'); }

  console.log('[webhook/wayforpay] payload:', JSON.stringify(payload));

  const norm = wayforpay.normalizeWebhook(payload);
  const parsed = parseReference(norm.reference);

  if (!parsed) {
    console.warn('[webhook/wayforpay] unknown reference:', norm.reference);
    return sendAck(res, norm.reference || 'unknown', { ignored: 'unknown reference' });
  }

  // Verify signature — reject forged callbacks.
  const sig = await wayforpay.verifyWebhook(payload);
  if (!sig.verified) {
    console.error(`[webhook/wayforpay] signature INVALID ref=${norm.reference}: ${sig.reason}`);
    // Still send ACK so WFP stops retrying an invalid webhook (but log loudly).
    return sendAck(res, norm.reference, { signature_error: sig.reason });
  }

  if (!norm.isSuccess) {
    console.log(`[webhook/wayforpay] non-success transactionStatus='${norm.status}' ref=${norm.reference}`);
    return sendAck(res, norm.reference, { ignored_status: norm.status });
  }

  try {
    const result = await markLearnerPaid({
      telegram_id: parsed.telegram_id,
      telegram_first_name: `TG:${parsed.telegram_id}`,
      payment_amount_uah: norm.amount_uah,
      payment_provider: wayforpay.NOCODB_PROVIDER_VALUE,
      transaction_id: norm.transaction_id,
      reference: norm.reference,
    });
    return sendAck(res, norm.reference, {
      accepted: true,
      created: result.created,
      alreadyPaid: result.alreadyPaid,
      uuid: result.learner?.uuid || null,
    });
  } catch (e) {
    console.error('[webhook/wayforpay] markLearnerPaid error:', e);
    // Don't ACK — let WFP retry so we get another chance if NocoDB is transiently down.
    return fail(res, 500, 'nocodb error', String(e.message || e));
  }
};
