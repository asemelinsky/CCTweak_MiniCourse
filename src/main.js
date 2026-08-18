/**
 * Bootstrap: інжектує Blockly, готує level, wire'ить кнопки.
 */

'use strict';

function initApp() {
  // Мова Blockly вже завантажена через <script src=".../msg/uk.js">
  const toolboxXml = document.getElementById('toolbox');

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

  // URL param ?lesson=2 → завантажуємо L2. Default (без param) → L1.
  // Розширюваний паттерн: додай новий case у switch щоб підключити L3+.
  const urlParams = new URLSearchParams(window.location.search);
  const lessonParam = urlParams.get('lesson');
  const lessonId = (lessonParam === '2') ? 'l2' : 'l1';
  window.currentLessonId = lessonId;   // читає simulator.initLevel()
  console.log(`[main] Loading lesson: ${lessonId} (URL param: ${lessonParam || 'none'})`);

  // Init level (map через getLevelMap(lessonId))
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
