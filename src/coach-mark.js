/**
 * CoachMark — dark overlay + spotlight на target-елементі + callout з текстом.
 *
 * Візуально: весь екран притемнюється, окрім прямокутника target-елемента.
 * Поряд з ним — callout з поясненням і кнопкою «Далі» (якщо advance = click-next).
 *
 * Реалізація spotlight: overlay покриває все, у нього SVG-mask з дірою у місці target.
 *
 * Position: 'right' | 'left' | 'top' | 'bottom' — де розмістити callout відносно target.
 *
 * Використання:
 *   CoachMark.show({ target: '.blocklyToolboxDiv', text: '...', position: 'right' });
 *   CoachMark.hide();
 */

'use strict';

const CoachMark = (function() {

  let currentOverlay = null;
  let currentCallout = null;
  let resizeHandler  = null;

  function show(beat) {
    hide();

    const targetEl = document.querySelector(beat.target);
    if (!targetEl) {
      console.warn(`[CoachMark] Не знайдено target: ${beat.target}`);
      // Все одно показуємо callout без spotlight — граційно деградуємо
      showCalloutOnly(beat);
      return;
    }

    // 1. Overlay з дірою — використовуємо SVG mask
    const overlay = createOverlayWithSpotlight(targetEl);
    document.body.appendChild(overlay);
    currentOverlay = overlay;

    // 2. Callout
    const callout = createCallout(beat, targetEl);
    document.body.appendChild(callout);
    currentCallout = callout;

    // Оновлювати при resize (Blockly може ремесуватись)
    resizeHandler = () => {
      const t = document.querySelector(beat.target);
      if (t) {
        updateSpotlight(overlay, t);
        positionCallout(callout, t, beat.position || 'right');
      }
    };
    window.addEventListener('resize', resizeHandler);

    // Плавна поява
    requestAnimationFrame(() => {
      overlay.classList.add('lesson-coach-overlay--visible');
      callout.classList.add('lesson-coach-callout--visible');
    });

    // Voice-over (той самий auto-URL patterns що у SpeechBubble §2)
    if (window.AudioPlayer) {
      const voiceUrl = beat.voice_url || (beat.id && beat.lesson_id
        ? `public/audio/${beat.lesson_id}/${beat.id}.mp3`
        : null);
      if (voiceUrl) AudioPlayer.playVoice(voiceUrl);
    }
  }

  function createOverlayWithSpotlight(targetEl) {
    const overlay = document.createElement('div');
    overlay.className = 'lesson-coach-overlay';

    // SVG з масками — дірка над target-ом
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lesson-coach-svg');
    svg.setAttribute('width',  '100%');
    svg.setAttribute('height', '100%');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.setAttribute('id', 'lesson-coach-mask');

    // «Все біле» = все видиме (буде прозоре)
    const whiteRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    whiteRect.setAttribute('x', '0');
    whiteRect.setAttribute('y', '0');
    whiteRect.setAttribute('width',  '100%');
    whiteRect.setAttribute('height', '100%');
    whiteRect.setAttribute('fill', 'white');
    mask.appendChild(whiteRect);

    // «Чорна дірка» = там де target — прозоро
    const holeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    holeRect.setAttribute('id', 'lesson-coach-hole');
    holeRect.setAttribute('rx', '8');
    holeRect.setAttribute('ry', '8');
    holeRect.setAttribute('fill', 'black');
    mask.appendChild(holeRect);

    defs.appendChild(mask);
    svg.appendChild(defs);

    // Прямокутник що затемнює все, з mask
    const shade = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    shade.setAttribute('x', '0');
    shade.setAttribute('y', '0');
    shade.setAttribute('width',  '100%');
    shade.setAttribute('height', '100%');
    shade.setAttribute('fill', 'rgba(0, 0, 0, 0.65)');
    shade.setAttribute('mask', 'url(#lesson-coach-mask)');
    svg.appendChild(shade);

    overlay.appendChild(svg);

    // Виставити координати дірки під target
    updateSpotlight(overlay, targetEl);

    return overlay;
  }

  function updateSpotlight(overlay, targetEl) {
    const hole = overlay.querySelector('#lesson-coach-hole');
    if (!hole) return;
    const rect = targetEl.getBoundingClientRect();
    const padding = 8;
    hole.setAttribute('x',      Math.max(0, rect.left - padding));
    hole.setAttribute('y',      Math.max(0, rect.top  - padding));
    hole.setAttribute('width',  rect.width  + padding * 2);
    hole.setAttribute('height', rect.height + padding * 2);
  }

  function createCallout(beat, targetEl) {
    const callout = document.createElement('div');
    callout.className = 'lesson-coach-callout';

    const text = document.createElement('div');
    text.className = 'lesson-coach-callout__text';
    text.textContent = beat.text;
    callout.appendChild(text);

    if (beat.advance && beat.advance.type === 'click-next') {
      const btn = document.createElement('button');
      // LB-005: attention-pulse — universal invitation-glow (blue variant для
       // coach-mark, override у style-lesson.css).
      btn.className = 'lesson-coach-callout__next attention-pulse';
      btn.textContent = beat.advance.label || 'Далі';
      btn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('lesson-next-click'));
      });
      callout.appendChild(btn);
    } else {
      // Немає кнопки — просто підказка «чекаємо на дію»
      const hint = document.createElement('div');
      hint.className = 'lesson-coach-callout__hint';
      hint.textContent = '↑ Зроби це, і я перейду далі';
      callout.appendChild(hint);
    }

    positionCallout(callout, targetEl, beat.position || 'right');
    return callout;
  }

  function positionCallout(callout, targetEl, position) {
    const rect = targetEl.getBoundingClientRect();
    const OFFSET = 20;
    const W = 320;   // maxWidth
    const H = 120;   // approx height

    callout.style.position = 'fixed';
    callout.style.zIndex   = '10001';
    callout.style.maxWidth = W + 'px';
    // Скинути раніш встановлені якщо resize/repositioning
    callout.style.left = callout.style.right = callout.style.top = callout.style.bottom = '';

    switch (position) {
      case 'right':
        callout.style.left = (rect.right + OFFSET) + 'px';
        callout.style.top  = Math.max(10, rect.top + rect.height / 2 - H / 2) + 'px';
        break;
      case 'left':
        callout.style.left = Math.max(10, rect.left - W - OFFSET) + 'px';
        callout.style.top  = Math.max(10, rect.top + rect.height / 2 - H / 2) + 'px';
        break;
      case 'top':
        callout.style.left = Math.max(10, rect.left + rect.width / 2 - W / 2) + 'px';
        callout.style.top  = Math.max(10, rect.top - H - OFFSET) + 'px';
        break;
      case 'bottom':
      default:
        callout.style.left = Math.max(10, rect.left + rect.width / 2 - W / 2) + 'px';
        callout.style.top  = (rect.bottom + OFFSET) + 'px';
    }

    // Safeguard: коли позиціонування виходить за viewport → fallback у центр
    // Читаємо результуючі координати після applied styles
    requestAnimationFrame(() => {
      const cr = callout.getBoundingClientRect();
      const outOfView = cr.right < 20 || cr.left > window.innerWidth - 20 ||
                       cr.bottom < 20 || cr.top > window.innerHeight - 20;
      if (outOfView) {
        console.warn('[CoachMark] callout out of viewport, falling back to center');
        callout.style.left   = '50%';
        callout.style.top    = '50%';
        callout.style.right  = '';
        callout.style.bottom = '';
        callout.style.transform = 'translate(-50%, -50%)';
      }
    });
  }

  function showCalloutOnly(beat) {
    // Fallback коли target не знайдено — просто центрований callout
    const callout = document.createElement('div');
    callout.className = 'lesson-coach-callout lesson-coach-callout--center';
    callout.innerHTML = `
      <div class="lesson-coach-callout__text">${beat.text}</div>
    `;
    if (beat.advance && beat.advance.type === 'click-next') {
      const btn = document.createElement('button');
      // LB-005: attention-pulse — universal invitation-glow (blue variant для
       // coach-mark, override у style-lesson.css).
      btn.className = 'lesson-coach-callout__next attention-pulse';
      btn.textContent = beat.advance.label || 'Далі';
      btn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('lesson-next-click'));
      });
      callout.appendChild(btn);
    }
    document.body.appendChild(callout);
    currentCallout = callout;
    requestAnimationFrame(() => callout.classList.add('lesson-coach-callout--visible'));

    if (window.AudioPlayer) {
      const voiceUrl = beat.voice_url || (beat.id && beat.lesson_id
        ? `public/audio/${beat.lesson_id}/${beat.id}.mp3`
        : null);
      if (voiceUrl) AudioPlayer.playVoice(voiceUrl);
    }
  }

  function hide() {
    if (window.AudioPlayer) AudioPlayer.stopVoice();
    if (currentOverlay) {
      currentOverlay.classList.remove('lesson-coach-overlay--visible');
      const o = currentOverlay;
      setTimeout(() => { if (o.parentNode) o.parentNode.removeChild(o); }, 200);
      currentOverlay = null;
    }
    if (currentCallout) {
      currentCallout.classList.remove('lesson-coach-callout--visible');
      const c = currentCallout;
      setTimeout(() => { if (c.parentNode) c.parentNode.removeChild(c); }, 200);
      currentCallout = null;
    }
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
  }

  return { show, hide };
})();

window.CoachMark = CoachMark;
