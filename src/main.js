/**
 * Bootstrap: інжектує Blockly, готує level, wire'ить кнопки.
 */

'use strict';

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
  const lessonSelector = document.getElementById('lesson-selector');
  if (lessonSelector) {
    const isPaidFlow = urlParams.has('u');
    if (isPaidFlow) {
      lessonSelector.style.display = 'none';
      console.log('[main] Lesson selector hidden (paid flow, ?u= detected)');
    } else {
      lessonSelector.style.display = '';   // показуємо (скидаємо inline display:none з HTML)
      lessonSelector.value = lessonId;     // виставляємо поточний як selected
      lessonSelector.addEventListener('change', (e) => {
        const target = e.target.value;
        // Формуємо new URL: зберігаємо всі поточні URL params, крім ?u= (тільки на всяк випадок).
        // Оновлюємо або додаємо ?lesson=<N>. N — номер (1..7), не lessonId ('l1'..'l7').
        const newParams = new URLSearchParams(window.location.search);
        newParams.delete('u');
        // target = 'l1'..'l7' → number 1..7
        const lessonNumber = target.replace('l', '');
        newParams.set('lesson', lessonNumber);
        // Full page reload — простіше і consistent з existing pattern.
        window.location.search = '?' + newParams.toString();
      });
      console.log(`[main] Lesson selector shown (continuous flow), current: ${lessonId}`);
    }
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
