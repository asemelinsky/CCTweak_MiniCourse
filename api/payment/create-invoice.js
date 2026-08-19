// POST /api/payment/create-invoice
// Bot-facing endpoint. Creates a payment invoice via the currently active
// provider (ACTIVE_PAYMENT_PROVIDER=monobank|wayforpay) AND upserts the learner
// row with person-data supplied by the bot.
//
// Why upsert here: this is the ONLY code path that ever sees the child's name
// and age — the webhook only knows telegram_id (extracted from `reference`),
// and cannot fill these fields. See BUG-002 in bot-bugs.md.
//
// Body:
//   {
//     telegram_id: number,               required
//     amount_uah: number,                required (default 1 for smoke tests)
//     child_name?: string,               used in invoice destination + saved to learner
//     child_age?: number,                saved to learner (for template personalization)
//     telegram_first_name?: string,      saved to learner (used in reminders)
//     telegram_username?: string,        saved to learner (support/debug)
//     reference?: string,                override auto-generated reference
//     provider?: 'monobank'|'wayforpay'  override active for A/B smoke tests
//   }
//
// Response:
//   { invoice_id, pageUrl, provider, reference, active_provider }
//
// Auth: Bearer BOT_SECRET (same as other bot endpoints).

const {
  handleOptions,
  ok,
  fail,
  readBody,
  requireBearer,
  generateUuid,
  getLearnerByTelegramId,
  insertLearner,
  updateLearner,
  nowIso,
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
    child_age = null,
    telegram_first_name = null,
    telegram_username = null,
    reference: refOverride = null,
    provider: providerOverride = null,
  } = body || {};

  if (!telegram_id || !Number.isFinite(+telegram_id)) {
    return fail(res, 400, 'telegram_id required (number)');
  }
  if (!Number.isFinite(+amount_uah) || +amount_uah <= 0) {
    return fail(res, 400, 'amount_uah must be > 0');
  }

  // Upsert learner with person-data BEFORE creating the invoice.
  // Payment > personalization: any failure here is logged and swallowed so
  // the checkout link is still generated. The webhook later finds the learner
  // already exists → its (!learner) branch skips → these fields survive.
  try {
    const learner = await getLearnerByTelegramId(+telegram_id);
    if (!learner) {
      await insertLearner({
        uuid: generateUuid(),
        telegram_id: +telegram_id,
        telegram_username,
        telegram_first_name: telegram_first_name || `TG:${telegram_id}`,
        child_name,
        child_age: child_age === null ? null : (+child_age || null),
        created_at: nowIso(),
      });
    } else {
      // Fill only empty fields — never overwrite what the user already provided.
      // The one exception: telegram_first_name that starts with `TG:` is a webhook
      // placeholder and gets replaced by the real name when the bot supplies it.
      const patch = {};
      if (!learner.child_name && child_name) patch.child_name = child_name;
      if (!learner.child_age && child_age) patch.child_age = +child_age;
      if (telegram_first_name && String(learner.telegram_first_name || '').startsWith('TG:')) {
        patch.telegram_first_name = telegram_first_name;
      }
      if (!learner.telegram_username && telegram_username) patch.telegram_username = telegram_username;
      if (Object.keys(patch).length) await updateLearner(learner.Id, patch);
    }
  } catch (e) {
    console.error(`create-invoice: learner upsert failed (tg=${telegram_id}):`, e);
    // fall through — invoice creation must still proceed
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
