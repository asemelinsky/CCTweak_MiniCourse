/**
 * SpeechBubble — SVG-bubble біля черепашки з текстом і кнопкою «Далі».
 *
 * Показується як HTML-overlay поверх сцени, з absolute-position біля
 * поточної позиції черепашки. Стрілка «хвостик» вказує на черепашку.
 *
 * Анімації характеру Мо:
 *   - wiggle → легке погойдування вправо-вліво
 *   - jump   → підскок вгору-вниз
 *   - shake  → тряска (для «врізалась»)
 *
 * Використання:
 *   SpeechBubble.show({ text: '...', character: 'mo', animation: 'wiggle',
 *                       advance: { type: 'click-next', label: 'Далі' } });
 *   SpeechBubble.hide();
 */

'use strict';

const SpeechBubble = (function() {

  let currentEl = null;
  let currentBackdrop = null;
  let nextBtnEnableTimer = null;

  // Modal behavior: під час показу bubble
  //  - півпрозорий backdrop покриває весь екран (перехоплює кліки → workspace,
  //    ▶ Run, ↺ Reset заблоковані)
  //  - bubble центрований на екрані (не floating внизу як раніше)
  //  - кнопка «Далі» disabled перші 3 сек — дитина мусить побачити текст
  //    і почути перші секунди голосу Мо. Через 3 сек кнопка активна + pulse.

  function show(beat) {
    hide();  // якщо був попередній — прибираємо

    // Backdrop під bubble — блокує все UI поки modal відкритий
    const backdrop = document.createElement('div');
    backdrop.className = 'lesson-speech-backdrop';
    document.body.appendChild(backdrop);
    // Плавна поява backdrop'а
    requestAnimationFrame(() => backdrop.classList.add('lesson-speech-backdrop--visible'));
    currentBackdrop = backdrop;

    // Створюємо DOM-елемент bubble
    const el = document.createElement('div');
    el.className = 'lesson-speech-bubble';
    el.setAttribute('data-character', beat.character || 'mo');

    // Внутрішня структура
    const content = document.createElement('div');
    content.className = 'lesson-speech-bubble__content';

    const avatar = document.createElement('div');
    avatar.className = 'lesson-speech-bubble__avatar';
    avatar.textContent = beat.character === 'olexii' ? '👨‍🏫' : '🐢';
    if (beat.animation) {
      avatar.classList.add(`lesson-anim-${beat.animation}`);
    }

    const text = document.createElement('div');
    text.className = 'lesson-speech-bubble__text';
    text.textContent = beat.text;

    content.appendChild(avatar);
    content.appendChild(text);
    el.appendChild(content);

    // LB-001: reference image під текстом (для beat'ів де візуальний приклад
    // важливіший ніж описом-текстом — напр. L4 guided-build «збери таку програму»).
    // Optional field beat.reference_image = path до SVG/PNG у public/images/.
    // Bubble автоматично росте у висоту, image стискається max-width відповідно.
    if (beat.reference_image) {
      const img = document.createElement('img');
      img.className = 'lesson-speech-bubble__reference';
      img.src = beat.reference_image;
      img.alt = 'Приклад — так має виглядати результат';
      el.appendChild(img);
    }

    // Кнопка «Далі», якщо advance = click-next
    if (beat.advance && beat.advance.type === 'click-next') {
      const btn = document.createElement('button');
      // Modal behavior: спочатку кнопка disabled (3 сек) — дитина мусить
      // побачити modal і послухати перші секунди Мо. Через 3 сек — enabled + pulse.
      btn.className = 'lesson-speech-bubble__next lesson-speech-bubble__next--waiting';
      btn.disabled = true;
      btn.textContent = beat.advance.label || 'Далі';
      btn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('lesson-next-click'));
      });
      // Enable через 3000ms + pulse
      if (nextBtnEnableTimer) clearTimeout(nextBtnEnableTimer);
      nextBtnEnableTimer = setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('lesson-speech-bubble__next--waiting');
        btn.classList.add('attention-pulse');
        nextBtnEnableTimer = null;
      }, 3000);
      el.appendChild(btn);
    }

    // Позиціонуємо: у нижньому центрі area над сценою
    positionBubble(el);

    document.body.appendChild(el);
    currentEl = el;

    // Плавна поява
    requestAnimationFrame(() => el.classList.add('lesson-speech-bubble--visible'));

    // Voice-over: спробувати з переданого voice_url, або з auto-шляху
    const voiceUrl = beat.voice_url || (beat.id && beat.lesson_id
      ? `public/audio/${beat.lesson_id}/${beat.id}.mp3`
      : null);
    if (window.AudioPlayer && voiceUrl) {
      AudioPlayer.playVoice(voiceUrl);
    }

    // Actions bar у top-right corner: ⏮ 🔁 ⏭
    //  - ⏮/⏭ (LB-015) — навігація по visited beats (див. LessonEngine.jumpToVisitedBeat)
    //  - 🔁 (post-pilot) — програти voice поточного beat знову; тільки якщо voiceUrl є
    // Порядок: prev у краю зліва, replay посередині, next у краю справа —
    // logically «попередній / програти цей знову / наступний».
    const actions = document.createElement('div');
    actions.className = 'lesson-speech-bubble__actions';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'lesson-speech-bubble__nav-prev lesson-nav-btn';
    prevBtn.type = 'button';
    prevBtn.textContent = '⏮';
    prevBtn.setAttribute('aria-label', 'Попереднє повідомлення');
    prevBtn.setAttribute('title', 'Попереднє повідомлення');
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.LessonEngine && typeof window.LessonEngine.jumpToVisitedBeat === 'function') {
        window.LessonEngine.jumpToVisitedBeat(-1);
      }
    });
    actions.appendChild(prevBtn);

    if (voiceUrl) {
      const replayBtn = document.createElement('button');
      replayBtn.className = 'lesson-speech-bubble__replay';
      replayBtn.type = 'button';
      replayBtn.textContent = '🔁';
      replayBtn.setAttribute('aria-label', 'Повторити пояснення');
      replayBtn.setAttribute('title', 'Повторити пояснення');
      replayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.AudioPlayer) AudioPlayer.playVoice(voiceUrl);
      });
      actions.appendChild(replayBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'lesson-speech-bubble__nav-next lesson-nav-btn';
    nextBtn.type = 'button';
    nextBtn.textContent = '⏭';
    nextBtn.setAttribute('aria-label', 'Наступне повідомлення');
    nextBtn.setAttribute('title', 'Наступне повідомлення');
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.LessonEngine && typeof window.LessonEngine.jumpToVisitedBeat === 'function') {
        window.LessonEngine.jumpToVisitedBeat(+1);
      }
    });
    actions.appendChild(nextBtn);

    // Disabled стан за станом LessonEngine (може бути false-y якщо engine ще не активний)
    if (window.LessonEngine && typeof window.LessonEngine.getNavigationState === 'function') {
      const navState = window.LessonEngine.getNavigationState();
      if (!navState.canGoBack) {
        prevBtn.disabled = true;
        prevBtn.setAttribute('aria-disabled', 'true');
      }
      if (!navState.canGoForward) {
        nextBtn.disabled = true;
        nextBtn.setAttribute('aria-disabled', 'true');
      }
    } else {
      // Немає engine — не мaйe сенсу навігувати, disable обидва
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    }

    el.appendChild(actions);
  }

  function positionBubble(el) {
    // Modal-style: центрувати посередині екрана (замість floating внизу).
    // Backdrop блокує все під ним, bubble на верхньому z-index.
    el.style.position = 'fixed';
    el.style.top       = '50%';
    el.style.left      = '50%';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.zIndex   = '10001';  // above backdrop (10000)
  }

  function hide() {
    if (window.AudioPlayer) AudioPlayer.stopVoice();
    if (nextBtnEnableTimer) { clearTimeout(nextBtnEnableTimer); nextBtnEnableTimer = null; }
    if (currentBackdrop) {
      const bd = currentBackdrop;
      currentBackdrop = null;
      bd.classList.remove('lesson-speech-backdrop--visible');
      setTimeout(() => { if (bd.parentNode) bd.parentNode.removeChild(bd); }, 300);
    }
    if (!currentEl) return;
    const el = currentEl;
    currentEl = null;
    el.classList.remove('lesson-speech-bubble--visible');
    // прибираємо через 300 мс (плавне зникнення)
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }

  return { show, hide };
})();

window.SpeechBubble = SpeechBubble;
