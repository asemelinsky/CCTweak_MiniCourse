/**
 * VideoOverlay — модальний overlay з відео у центрі екрану.
 *
 * Використовується для beat-типу `video-overlay`. Показує mp4 у круглій рамці
 * (для аватара-Олексія з Hedra), з dim backdrop, кнопкою «Далі» яка стає доступною
 * після мінімального перегляду (dismissible_after_ms) або одразу.
 *
 * Автоплей + м'юта=false (треба unlock через user gesture — але для першого відео
 * після завантаження сторінки автоплей може бути заблокований, тоді показуємо
 * велику Play-кнопку у центрі).
 *
 * Beat format:
 *   {
 *     "type": "video-overlay",
 *     "src": "public/videos/l1/01-olexii-intro.mp4",
 *     "duration_ms": 30000,             // orientation, не критично
 *     "dismissible_after_ms": 5000,     // коли з'явиться кнопка «Далі»
 *     "advance": { "type": "click-next", "label": "Далі" }
 *   }
 *
 * Використання:
 *   VideoOverlay.show(beat);
 *   VideoOverlay.hide();
 */

'use strict';

const VideoOverlay = (function() {

  let currentBackdrop = null;

  function show(beat) {
    hide();

    // 1. Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'lesson-video-backdrop';

    // 2. Video container (кругла рамка)
    const container = document.createElement('div');
    container.className = 'lesson-video-container';

    // 3. Video element
    const video = document.createElement('video');
    video.src = beat.src;
    video.controls = false;
    video.playsInline = true;
    video.autoplay = true;
    video.muted = false;
    video.preload = 'auto';

    container.appendChild(video);
    backdrop.appendChild(container);

    // 4. Play button (для випадку коли autoplay заблокований)
    const playBtn = document.createElement('button');
    playBtn.className = 'lesson-video-playbtn';
    playBtn.textContent = '▶';
    playBtn.style.display = 'none';
    playBtn.addEventListener('click', () => {
      video.play();
      playBtn.style.display = 'none';
    });
    container.appendChild(playBtn);

    // 5. Next button (з'являється після dismissible_after_ms або одразу)
    const nextBtn = document.createElement('button');
    nextBtn.className = 'lesson-video-nextbtn';
    nextBtn.textContent = (beat.advance && beat.advance.label) || 'Далі';
    nextBtn.style.display = 'none';
    nextBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('lesson-next-click'));
    });
    backdrop.appendChild(nextBtn);

    document.body.appendChild(backdrop);
    currentBackdrop = backdrop;

    // Плавна поява
    requestAnimationFrame(() => backdrop.classList.add('lesson-video-backdrop--visible'));

    // Error handler — коли файл відео не існує (напр. Olexii ще не записав).
    // Замість чорного екрана показуємо fallback_text (з beat) або дефолт.
    // Post-pilot design: beats з video-overlay готові до життя ДО того як
    // reальний файл існує (щоб не блокувати testing lesson JSON).
    video.addEventListener('error', () => {
      container.innerHTML = '';
      const fallback = document.createElement('div');
      fallback.className = 'lesson-video-fallback';
      fallback.textContent = beat.fallback_text ||
        '🎬 Відео скоро буде тут. Натисни «Далі» щоб продовжити урок.';
      container.appendChild(fallback);
      nextBtn.style.display = 'block';   // одразу показати Next
      playBtn.style.display = 'none';
    });

    // Спробувати autoplay
    video.play().catch(() => {
      // Autoplay заблоковано — показуємо Play-кнопку
      playBtn.style.display = 'flex';
    });

    // Next-кнопка з'являється після dismissible_after_ms (default 3 сек), або коли відео закінчилось
    const dismissAfter = beat.dismissible_after_ms || 3000;
    setTimeout(() => { nextBtn.style.display = 'block'; }, dismissAfter);
    video.addEventListener('ended', () => {
      nextBtn.style.display = 'block';
      nextBtn.classList.add('lesson-video-nextbtn--pulse');
    });
  }

  function hide() {
    if (!currentBackdrop) return;
    const el = currentBackdrop;
    currentBackdrop = null;
    el.classList.remove('lesson-video-backdrop--visible');
    // Зупинити відео перед видаленням
    const video = el.querySelector('video');
    if (video) {
      video.pause();
      video.src = '';
    }
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }

  return { show, hide };
})();

window.VideoOverlay = VideoOverlay;
