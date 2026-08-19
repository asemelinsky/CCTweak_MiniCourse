// POST /api/payment/create-invoice
// Sprint-1 manual-test endpoint (без bot). Creates a payment invoice via the
// currently active provider (ACTIVE_PAYMENT_PROVIDER=monobank|wayforpay).
//
// Body:
//   {
//     telegram_id: number,          required
//     amount_uah: number,           required (default 1 for smoke tests)
//     child_name?: string,          used in `destination` text
//     reference?: string,           override auto-generated reference
//     provider?: 'monobank'|'wayforpay'  override active for A/B smoke tests
//   }
//
// Response:
//   { invoice_id, pageUrl, provider, reference, active_provider }
//
// Auth: Bearer BOT_SECRET (same as other bot endpoints — this is a test/back-office
// caller, not a public form). Set the header or hit from a curl with the secret.

const {
  handleOptions,
  ok,
  fail,
  readBody,
  requireBearer,
  generateUuid,
} = require('../_lib');
const { getActiveProviderName, getProvider } = require('./_router');

const PUBLIC_APP_URL =
  process.env.PUBLIC_APP_URL || 'https://cctweak-minicourse.vercel.app';

const BOT_REDIRECT_URL =
  process.env.BOT_REDIRECT_URL || 'https://t.me/SkillBridge_LessonDelivery_bot';

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
  if (!requireBearer(req, res, 'BOT_SECRET')) return;

  let body;
  try { body = await readBody(req); } catch { return fail(res, 400, 'invalid JSON body'); }

  const {
    telegram_id,
    amount_uah = 1,
    child_name = null,
    reference: refOverride = null,
    provider: providerOverride = null,
  } = body || {};

  if (!telegram_id || !Number.isFinite(+telegram_id)) {
    return fail(res, 400, 'telegram_id required (number)');
  }
  if (!Number.isFinite(+amount_uah) || +amount_uah <= 0) {
    return fail(res, 400, 'amount_uah must be > 0');
  }

  let providerName;
  try {
    providerName = providerOverride ? String(providerOverride).toLowerCase() : getActiveProviderName();
  } catch (e) {
    return fail(res, 500, 'active provider misconfigured', String(e.message || e));
  }

  let provider;
  try { provider = getProvider(providerName); }
  catch (e) { return fail(res, 400, String(e.message || e)); }

  const reference = refOverride || `cctweak-${telegram_id}-${generateUuid()}`;
  const destination = child_name
    ? `Курс CCTweak Мо для ${child_name}`
    : 'Курс CCTweak Мо';

  const webhook_url = `${PUBLIC_APP_URL}/api/webhook/${providerName}`;

  try {
    const invoice = await provider.createInvoice({
      amount_uah: +amount_uah,
      reference,
      destination,
      webhook_url,
      redirect_url: BOT_REDIRECT_URL,
    });
    return ok(res, {
      invoice_id: invoice.invoice_id,
      pageUrl: invoice.pageUrl,
      provider: invoice.provider,
      reference: invoice.reference,
      active_provider: getActiveProviderName(),
      webhook_url,
    }, 201);
  } catch (e) {
    console.error(`create-invoice(${providerName}) error:`, e);
    return fail(res, 502, 'provider error', String(e.message || e));
  }
};
