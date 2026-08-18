/**
 * progress-tracker.js — localStorage state для free tier (L1).
 *
 * Стратегія «two-tier delivery»:
 *   • Free tier (без ?u=<uuid> у URL) — ProgressTracker активний,
 *     зберігає стан у localStorage. Це L1 демо для conversion.
 *   • Paid tier (з ?u=<uuid> у URL) — ProgressTracker неактивний,
 *     стан живе у NocoDB (див. specs/nocodb-schema-spec.md).
 *
 * Що зберігає (тільки для free L1):
 *   • Чи пройшов L1 і коли (для «welcome back» модалки)
 *   • Скільки спроб на L1 (для аналітики conversion → paid)
 *   • Payment intent (клік на «Оплатити» CTA — навіть якщо не завершив)
 *
 * Що НЕ зберігає:
 *   • Beat-level state — для L1 занадто overhead
 *   • Progress по L2+ — тільки paid tier, тільки backend
 *
 * User journey docs: courses/cctweak-minicourse/user-journey.md
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'cctweak_free_state';

  // Активуємо ProgressTracker ТІЛЬКИ якщо це free tier (URL без ?u=)
  const urlParams = new URLSearchParams(window.location.search);
  const isPaidTier = urlParams.has('u');

  if (isPaidTier) {
    console.log('[ProgressTracker] Paid tier detected (?u=). Tracker disabled.');
    window.ProgressTracker = {
      markLessonCompleted: () => {},
      markPaymentIntent: () => {},
      getState: () => null,
      isFreeReturner: () => false,
      clear: () => {}
    };
    return;
  }

  console.log('[ProgressTracker] Free tier — localStorage tracking active.');

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('[ProgressTracker] Load error, resetting:', e);
      return {};
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage може бути disabled (private mode) — не критично
      console.warn('[ProgressTracker] Save error:', e);
    }
  }

  function markLessonCompleted(lessonId) {
    // У free tier зберігаємо тільки L1 completions.
    // L2+ у free tier не існує (URL без ?u= завантажує L1 default).
    if (lessonId !== 'l1') return;

    const state = loadState();
    state.l1_completed_at = new Date().toISOString();
    state.l1_completions = (state.l1_completions || 0) + 1;
    saveState(state);
    console.log('[ProgressTracker] L1 completed:', state.l1_completions, 'times');
  }

  function markPaymentIntent(lessonId) {
    const state = loadState();
    state.payment_intent_at = new Date().toISOString();
    state.payment_intent_from_lesson = lessonId;
    saveState(state);
    console.log('[ProgressTracker] Payment intent from', lessonId);
  }

  function getState() {
    return loadState();
  }

  function isFreeReturner() {
    // Returner = мама, що вже проходила L1 і повертається знову.
    // Показуємо їй special welcome bubble замість повного intro.
    const state = loadState();
    return Boolean(state.l1_completed_at);
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[ProgressTracker] State cleared.');
  }

  // Для дебагу з DevTools
  window.ProgressTracker = {
    markLessonCompleted,
    markPaymentIntent,
    getState,
    isFreeReturner,
    clear
  };
})();
