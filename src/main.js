/**
 * Bootstrap: інжектує Blockly, готує level, wire'ить кнопки.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// Pilot telemetry — глобальні signals (не beat-scoped).
// Все летить через document.dispatchEvent('pilot-*') → engine
// слухає і робить pilotTrack (додає lesson_id + beat_id context).
//
// Fired unconditionally на будь-якій сторінці. Engine filter'ить
// по наявності ?u=<uuid> у URL — без uuid нічого не шле у backend.
// ─────────────────────────────────────────────────────────────
(function setupGlobalPilotSignals() {
  const dispatch = (name, detail) => {
    try { document.dispatchEvent(new CustomEvent('pilot-' + name, { detail: detail || {} })); }
    catch (e) {}
  };

  // A. JS ERRORS — safety net. Ситуації типу Лізиної: якщо у Chrome
  // stalьнеться JS error який silently ламає engine — знатимемо факт.
  window.addEventListener('error', (e) => {
    dispatch('js_error', {
      message: (e.message || '').slice(0, 500),
      source:  (e.filename || '').slice(0, 200),
      lineno:  e.lineno,
      colno:   e.colno,
      stack:   e.error && e.error.stack ? String(e.error.stack).slice(0, 800) : null,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    dispatch('js_promise_rejection', {
      reason: String(e.reason || '').slice(0, 500),
    });
  });

  // B. IDLE DETECTION — >5 сек без input → idle_start; при русі → idle_end
  // з тривалістю. Розкриє довгі паузи як факт («144 сек idle» замість
  // просто «144 сек на beat»).
  const IDLE_MS = 5000;
  let idleTimer = null;
  let idleStartTs = null;
  function onActivity() {
    if (idleStartTs) {
      dispatch('idle_end', { duration_ms: Date.now() - idleStartTs });
      idleStartTs = null;
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleStartTs = Date.now();
      dispatch('idle_start', {});
    }, IDLE_MS);
  }
  ['mousedown', 'keydown', 'touchstart', 'wheel'].forEach(ev =>
    document.addEventListener(ev, onActivity, { passive: true, capture: true }));
  // mousemove throttled — інакше при перших рухах спам events (переміщення миші)
  let lastMouseMoveTs = 0;
  document.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMouseMoveTs > 1000) { lastMouseMoveTs = now; onActivity(); }
  }, { passive: true, capture: true });
  onActivity(); // старт timer одразу

  // F. VISIBILITY CHANGE — перемикання табу / мінімізація вікна.
  // Точний proxy для «дитина відвернулась / зайшла у інший додаток».
  let hiddenAtTs = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAtTs = Date.now();
      dispatch('visibility_hidden', {});
    } else {
      dispatch('visibility_visible', {
        away_ms: hiddenAtTs ? Date.now() - hiddenAtTs : null,
      });
      hiddenAtTs = null;
    }
  });
})();

function initApp() {
  // URL param ?lesson=N → визначає який урок стартує.
  // Читаємо ДО Blockly.inject бо toolbox залежить від уроку (прогресивне розкриття).
  const urlParams = new URLSearchParams(window.location.search);
  const lessonParam = urlParams.get('lesson');
  const lessonMap = { '2': 'l2', '3': 'l3', '4': 'l4', '5': 'l5', '6': 'l6', '7': 'l7' };
  const lessonId = lessonMap[lessonParam] || 'l1';
  window.currentLessonId = lessonId;   // читає simulator.initLevel()
  console.log(`[main] Loading lesson: ${lessonId} (URL param: ${lessonParam || 'none'})`);

  // Мова Blockly вже завантажена через <script src=".../msg/uk.js">
  // Toolbox — за lessonId (див. src/toolbox-config.js для прогресії).
  // Fallback на статичний XML з index.html якщо ToolboxConfig не завантажився.
  let toolboxXml;
  if (window.ToolboxConfig) {
    // Parse XML string у Element через DOMParser
    const xmlString = window.ToolboxConfig.getToolboxXml(lessonId);
    toolboxXml = new DOMParser().parseFromString(xmlString, 'text/xml').documentElement;
    console.log(`[main] Toolbox: ${window.ToolboxConfig.TOOLBOX_CONFIG[lessonId].join(', ')}`);
  } else {
    toolboxXml = document.getElementById('toolbox');
    console.warn('[main] ToolboxConfig не завантажено, використовую fallback з index.html');
  }

  // exposed на window для e2e-тестів через playwright
  window.workspace = Blockly.inject('blockly-div', {
    toolbox: toolboxXml,
    trashcan: true,
    scrollbars: true,
    zoom: {
      controls: true,
      wheel: true,
      startScale: 1.0,
      maxScale: 2.0,
      minScale: 0.5,
      scaleSpeed: 1.1,
    },
    grid: {
      spacing: 20,
      length: 3,
      colour: '#ccc',
      snap: true,
    },
  });

  // Init level (map через getLevelMap(lessonId) — lessonId уже виставлено вище)
  initLevel();

  // Стартуємо мінікурс — тут це завжди lesson mode
  window._lessonMode = true;

  // Audio unlock: перший beat кожного уроку — video-overlay з голосом Олексія.
  // Дитина клікає ▶ на video → відео грає зі звуком → Chrome автоматично
  // unlocks audio context для всього сайту → далі mp3 голоси Мо грають без блокування.
  // Окремий start-overlay не потрібен: він тільки додає зайвий «церемоніальний» клік
  // не вирішуючи справжню проблему (див. commit що це видалив).
  LessonEngine.load(`lessons/${lessonId}.json`)
    .then(engineResult => engineResult.start())
    .catch(err => {
      console.error('[main] Не вдалося завантажити урок:', err);
      alert('Помилка завантаження уроку. Спробуй перезавантажити сторінку.');
    });

  // Wire buttons
  document.getElementById('btn-run').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('lesson-run-clicked'));
    executeUserCode();
  });
  document.getElementById('btn-reset').addEventListener('click', reset);
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-overlay').style.display = 'none';
  });

  // Level selector (Track 4) — quick navigation між уроками.
  // Показуємо ТІЛЬКИ у continuous flow (без ?u= param).
  // Paid flow (з ?u=xxx) — selector повністю прихований, щоб дитина
  // не могла перескакувати уроки минаючи послідовність.
  // LB-017: Level selector — 3 режими:
  //   1. Continuous (без ?u=): всі уроки активні, learner переключає як хоче (тестовий)
  //   2. Paid (?u=<uuid>): fetch learner state → тільки unlocked_lessons активні,
  //      майбутні — приглушені (disabled). Не hidden — селектор видно, щоб learner
  //      бачив прогрес.
  //   3. Admin escape (?u=<uuid>&admin=1): показати всі активні як у continuous —
  //      для тестування Оlexii'єм як учень але з можливістю переключатись.
  const lessonSelector = document.getElementById('lesson-selector');
  if (lessonSelector) {
    const uuid = urlParams.get('u');
    const isAdmin = urlParams.get('admin') === '1';
    const isPaidFlow = uuid && !isAdmin;

    // VPS secret-slug mode (mo.skillbridge.pp.ua/<slug>/) — у теці лежить тільки
    // один lesson JSON, тому level-selector не має сенсу: спроба перескочити на
    // інший урок веде на «Помилка завантаження» (l1.json відсутній у теці l5).
    // Selector повністю прихований — learner працює тільки з поточним уроком.
    const isVpsSecretMode = location.hostname === 'mo.skillbridge.pp.ua';
    if (isVpsSecretMode) {
      lessonSelector.style.display = 'none';
      console.log('[main] Level selector hidden (VPS secret-slug mode)');
      // Не робимо setupChangeHandler — блок закінчується тут для VPS
      // Продовжуємо resize handling нижче.
    } else {

    // Handler для change — універсальний (використовується у всіх режимах)
    const setupChangeHandler = () => {
      lessonSelector.addEventListener('change', (e) => {
        const target = e.target.value;
        const newParams = new URLSearchParams(window.location.search);
        // Зберігаємо ?u= і ?admin= щоб режим не «загубився» при переході між уроками
        const lessonNumber = target.replace('l', '');
        newParams.set('lesson', lessonNumber);
        window.location.search = '?' + newParams.toString();
      });
    };

    if (isPaidFlow) {
      // Paid flow — fetch learner state, disable не-пройдені
      lessonSelector.style.display = '';
      lessonSelector.value = lessonId;
      // Disable ВСЕ спочатку (safe default доки fetch не завершився)
      Array.from(lessonSelector.options).forEach(opt => { opt.disabled = true; });
      // Current option завжди enabled (learner тут)
      const currentOpt = lessonSelector.querySelector(`option[value="${lessonId}"]`);
      if (currentOpt) currentOpt.disabled = false;
      setupChangeHandler();

      // Fetch learner state async
      fetch(`/api/learner/${encodeURIComponent(uuid)}`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(data => {
          const unlocked = new Set(data.unlocked_lessons || [data.current_lesson || 'l1']);
          Array.from(lessonSelector.options).forEach(opt => {
            opt.disabled = !unlocked.has(opt.value);
          });
          console.log(`[main] Level selector paid mode: current=${data.current_lesson}, unlocked=${Array.from(unlocked).join(',')}`);
        })
        .catch(err => {
          // Fallback — learner не знайдений або network error. Залишаємо тільки current enabled.
          console.warn('[main] Level selector fetch failed, keeping only current lesson enabled:', err.message);
        });
    } else {
      // Continuous (без ?u=) АБО admin escape (?u=xxx&admin=1) → всі активні
      lessonSelector.style.display = '';
      lessonSelector.value = lessonId;
      Array.from(lessonSelector.options).forEach(opt => { opt.disabled = false; });
      setupChangeHandler();
      const mode = isAdmin ? 'admin escape (?admin=1)' : 'continuous flow';
      console.log(`[main] Level selector ${mode}, current: ${lessonId}`);
    }
    } // end else (non-VPS modes)
  }

  // Resize handling
  const onResize = () => Blockly.svgResize(window.workspace);
  window.addEventListener('resize', onResize);
  onResize();
}

// Запустити коли DOM готовий
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
