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

  function show(beat) {
    hide();  // якщо був попередній — прибираємо

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
      // LB-005: attention-pulse — scale+glow «дихання» на Next-кнопку як візуальний
      // афіш «сюди клік». Універсально для всіх bubbles з click-next advance.
      btn.className = 'lesson-speech-bubble__next attention-pulse';
      btn.textContent = beat.advance.label || 'Далі';
      btn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('lesson-next-click'));
      });
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
    // За замовчуванням — прикріплюємо до нижнього центру #simulator-panel
    // (не позиціонуємо точно біля черепашки, бо вона рухається — bubble мандрував би)
    el.style.position = 'fixed';
    el.style.bottom   = '20px';
    el.style.left     = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.zIndex   = '10000';
  }

  function hide() {
    if (window.AudioPlayer) AudioPlayer.stopVoice();
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
