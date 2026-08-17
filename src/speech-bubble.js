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

    // Кнопка «Далі», якщо advance = click-next
    if (beat.advance && beat.advance.type === 'click-next') {
      const btn = document.createElement('button');
      btn.className = 'lesson-speech-bubble__next';
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
