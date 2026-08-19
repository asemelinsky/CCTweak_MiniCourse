/**
 * DragonOverlay — Ender Dragon анімація «swoop & crunch».
 *
 * Використовується constraint-engine'ом коли дитина ставить заборонений
 * блок (напр. 2-й turtle_down на top-level у L7). Дракон залітає в
 * workspace, «зжирає» надлишковий блок (shake + fade), потім щезає.
 *
 * Публічний API:
 *   DragonOverlay.swoopAndCrunch(targetBlockElement, callback)
 *     — повний sequence ~3.1s: fly-in 1.5s → hover 800ms → dissolve 0.8s
 *     — callback() викликається після cleanup'у, engine далі робить .dispose()
 *
 *   DragonOverlay.markBlockForDeletion(blockElement)
 *     — standalone: тільки shake+fade без dragon overlay (для manual use)
 *
 * Assets: public/images/ender-dragon.webp (564x488) + .png fallback (400x346)
 * Sound: AudioPlayer.play('crunch') — з graceful fallback на failure.mp3
 *
 * Прив'язка позиції: fixed-positioned container, top/left обчислюються з
 * targetBlockElement.getBoundingClientRect() — дракон з'являється саме над
 * блоком-жертвою, а не «в загальному напрямку». Якщо targetElement пустий
 * (edge case під час undo), fallback до центру #blockly-div.
 */

'use strict';

const DragonOverlay = (function () {

  const DRAGON_WIDTH  = 180;
  const FLY_IN_MS     = 1500;
  const HOVER_MS      = 800;
  const DISSOLVE_MS   = 800;
  const FADE_OUT_MS   = 300;

  const IMG_WEBP = 'public/images/ender-dragon.webp';
  const IMG_PNG  = 'public/images/ender-dragon.png';

  function computeHoverPos(targetEl) {
    // Позиціонуємо дракона так, щоб його «морда» була приблизно над блоком-жертвою.
    // Дракон 180px wide, шукаємо приблизно центр над блоком.
    const rect = targetEl && targetEl.getBoundingClientRect
      ? targetEl.getBoundingClientRect()
      : null;
    if (rect && rect.width > 0) {
      return {
        top:  Math.max(20, rect.top - 60),
        left: Math.max(20, rect.left + rect.width / 2 - DRAGON_WIDTH / 2),
      };
    }
    // Fallback: центр workspace-panel
    const ws = document.getElementById('blockly-div');
    if (ws) {
      const r = ws.getBoundingClientRect();
      return { top: r.top + 30, left: r.left + r.width / 2 - DRAGON_WIDTH / 2 };
    }
    return { top: 80, left: window.innerWidth / 2 - DRAGON_WIDTH / 2 };
  }

  function buildOverlay(pos) {
    const container = document.createElement('div');
    container.className = 'dragon-swoop-container dragon-swoop';
    container.style.top  = pos.top  + 'px';
    container.style.left = pos.left + 'px';
    container.innerHTML =
      '<picture>' +
        '<source srcset="' + IMG_WEBP + '" type="image/webp">' +
        '<img src="' + IMG_PNG + '" alt="" draggable="false">' +
      '</picture>';
    return container;
  }

  function markBlockForDeletion(blockEl) {
    if (!blockEl || !blockEl.classList) return;
    blockEl.classList.add('block-being-eaten');
  }

  function swoopAndCrunch(targetBlockEl, callback) {
    const cb  = typeof callback === 'function' ? callback : function () {};
    const pos = computeHoverPos(targetBlockEl);
    const container = buildOverlay(pos);
    document.body.appendChild(container);

    // Phase 1: fly-in via CSS (1.5s).
    // Phase 2: hover (800ms) — дракон завис над блоком.
    setTimeout(function () {
      if (window.AudioPlayer && typeof AudioPlayer.play === 'function') {
        AudioPlayer.play('crunch');
      }
      markBlockForDeletion(targetBlockEl);
    }, FLY_IN_MS + HOVER_MS);

    // Phase 3: після shake-fade — fade out overlay і cleanup.
    setTimeout(function () {
      container.classList.add('dragon-swoop--leaving');
    }, FLY_IN_MS + HOVER_MS + DISSOLVE_MS);

    setTimeout(function () {
      if (container.parentNode) container.parentNode.removeChild(container);
      cb();
    }, FLY_IN_MS + HOVER_MS + DISSOLVE_MS + FADE_OUT_MS);
  }

  return {
    swoopAndCrunch: swoopAndCrunch,
    markBlockForDeletion: markBlockForDeletion,
  };
})();

window.DragonOverlay = DragonOverlay;
