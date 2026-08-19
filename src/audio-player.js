/**
 * AudioPlayer — звуковий менеджер уроку.
 *
 * Що керує:
 *   1) Voice-over для speech bubbles — озвучка Мо через попередньо-згенеровані mp3
 *      (Piper TTS з phase0-серверу, файли лежать у /public/audio/{lesson_id}/{beat_id}.mp3)
 *   2) Sound effects: step (крок черепашки), success (успіх), failure (невдача)
 *
 * Глобальний toggle: кнопка 🔊/🔈 у header, стан у localStorage як 'lesson_audio_enabled'.
 * Дефолт: ON.
 *
 * Використання:
 *   AudioPlayer.play('step');
 *   AudioPlayer.playVoice('/audio/l1/intro-1.mp3');
 *   AudioPlayer.setEnabled(false);
 *   AudioPlayer.isEnabled();
 */

'use strict';

const AudioPlayer = (function() {

  const STORAGE_KEY = 'lesson_audio_enabled';

  // Каталог SFX-файлів. Шляхи відносні до кореня.
  // Якщо файлу немає — play() тихо ігнорує (не крешить).
  const SFX = {
    step:      'public/audio/sfx/step.mp3',
    success:   'public/audio/sfx/success.mp3',
    failure:   'public/audio/sfx/failure.mp3',
    click:     'public/audio/sfx/click.mp3',
    'test-beep': 'public/audio/sfx/test-beep.mp3',
    // LB-011: TODO regen crunch.mp3 via ElevenLabs or use CC0 sample.
    // Falls back to failure.mp3 if file 404 (див. SFX_FALLBACKS нижче).
    crunch:    'public/audio/sfx/crunch.mp3',
  };

  // Якщо SFX не завантажився (404 / network), програвати fallback замість тиші.
  // Використовується для L7 constraint-engine — «хрум» через dragon має завжди
  // мати аудіо-feedback, навіть якщо crunch.mp3 ще не згенерований.
  const SFX_FALLBACKS = {
    crunch: 'failure',
  };

  // Set назв SFX, у яких load завершився помилкою — використовуємо для fallback routing.
  const sfxFailed = new Set();

  // Preloaded Audio-об'єкти для SFX (щоб не було затримки на першому відтворенні)
  const sfxCache = {};

  // Активний voice-over (щоб можна було зупинити при переході beat)
  let currentVoice = null;

  //////////////////////////////////////////////////////////////////////
  // Toggle
  //////////////////////////////////////////////////////////////////////

  function isEnabled() {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Default: ON. Явно 'false' → OFF.
    return stored !== 'false';
  }

  function setEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    if (!enabled) stopVoice();
    updateToggleButton();
    console.log(`[AudioPlayer] Toggle: ${enabled ? 'ON 🔊' : 'OFF 🔈'}`);
  }

  function toggle() {
    setEnabled(!isEnabled());
  }

  //////////////////////////////////////////////////////////////////////
  // SFX (короткі звуки)
  //////////////////////////////////////////////////////////////////////

  function preloadSfx() {
    for (const [name, url] of Object.entries(SFX)) {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = name === 'step' ? 0.7 : 0.9;
      // Ловимо помилку 404 тихо — якщо файлу нема, sfx просто не грає
      audio.addEventListener('error', () => {
        sfxFailed.add(name);
        const fb = SFX_FALLBACKS[name];
        if (fb) {
          console.warn(`[AudioPlayer] SFX не завантажився: ${url} → fallback на '${fb}'`);
        } else {
          console.warn(`[AudioPlayer] SFX не завантажився: ${url} (це ок, продовжуємо без нього)`);
        }
      });
      sfxCache[name] = audio;
    }
  }

  function play(name) {
    if (!isEnabled()) { console.log('[Audio] skip (disabled):', name); return; }
    // Fallback routing: якщо основний SFX не завантажився і для нього є fallback → play fallback.
    if (sfxFailed.has(name) && SFX_FALLBACKS[name]) {
      const fb = SFX_FALLBACKS[name];
      console.log('[Audio] fallback:', name, '→', fb);
      return play(fb);
    }
    const audio = sfxCache[name];
    if (!audio) { console.warn('[Audio] no sfx:', name); return; }
    if (audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      console.warn('[Audio] file not loaded:', name);
      if (SFX_FALLBACKS[name]) return play(SFX_FALLBACKS[name]);
      return;
    }
    try {
      audio.currentTime = 0;
      audio.play()
        .then(() => console.log('[Audio] ▶', name))
        .catch(err => console.warn('[Audio] blocked by browser:', name, err.message));
    } catch (e) { console.warn('[Audio] error:', name, e); }
  }

  //////////////////////////////////////////////////////////////////////
  // Voice-over (довші, для bubbles)
  //////////////////////////////////////////////////////////////////////

  // Черга «pending» — якщо autoplay заблокував, чекаємо першої взаємодії
  let pendingVoiceAudio = null;
  let unlockListenerRegistered = false;

  function playVoice(url) {
    if (!isEnabled()) return;
    if (!url) return;
    stopVoice();
    const audio = new Audio(url);
    audio.volume = 0.85;
    audio.addEventListener('error', () => {
      console.warn(`[AudioPlayer] Voice не завантажився: ${url} (це ок)`);
    });
    currentVoice = audio;
    audio.play().catch((err) => {
      // Autoplay policy заблокував. Зберігаємо як pending, при першому кліку граємо.
      console.log(`[AudioPlayer] Voice заблокований autoplay — чекаємо першого кліку. ${err.message}`);
      pendingVoiceAudio = audio;
      registerAutoplayUnlock();
    });
  }

  function registerAutoplayUnlock() {
    if (unlockListenerRegistered) return;
    unlockListenerRegistered = true;
    // Слухаємо БУДЬ-ЯКИЙ клік у документі — one-shot
    const unlock = () => {
      document.removeEventListener('click', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('touchstart', unlock, true);
      unlockListenerRegistered = false;
      if (pendingVoiceAudio && currentVoice === pendingVoiceAudio) {
        console.log('[AudioPlayer] User gesture отримано → граю pending voice');
        pendingVoiceAudio.play().catch(e => console.warn('[AudioPlayer] retry не пройшов:', e));
      }
      pendingVoiceAudio = null;
    };
    document.addEventListener('click',      unlock, true);
    document.addEventListener('keydown',    unlock, true);
    document.addEventListener('touchstart', unlock, true);
  }

  function stopVoice() {
    if (currentVoice) {
      currentVoice.pause();
      currentVoice.currentTime = 0;
      currentVoice = null;
    }
  }

  //////////////////////////////////////////////////////////////////////
  // Toggle button (створюємо у header)
  //////////////////////////////////////////////////////////////////////

  let toggleBtn = null;

  function installToggleButton() {
    const actions = document.getElementById('header-actions');
    if (!actions) return;

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'btn-audio-toggle';
    toggleBtn.className = 'btn btn-secondary';
    toggleBtn.title = 'Увімкнути / вимкнути звук';
    toggleBtn.addEventListener('click', () => {
      toggle();
      // User gesture unlocks audio + одразу грає підтвердження
      if (isEnabled()) play('test-beep');
    });

    // Вставляємо ПЕРЕД кнопкою «Скинути»
    actions.insertBefore(toggleBtn, actions.firstChild);

    updateToggleButton();
  }

  function updateToggleButton() {
    if (!toggleBtn) return;
    const on = isEnabled();
    toggleBtn.textContent = on ? '🔊 Звук' : '🔈 Тиша';
    toggleBtn.classList.toggle('audio-off', !on);
  }

  //////////////////////////////////////////////////////////////////////
  // Init
  //////////////////////////////////////////////////////////////////////

  function init() {
    preloadSfx();
    // Кнопка встановлюється після того як DOM готовий
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installToggleButton);
    } else {
      installToggleButton();
    }
  }

  init();

  return { play, playVoice, stopVoice, isEnabled, setEnabled, toggle };
})();

window.AudioPlayer = AudioPlayer;
