/**
 * mobile-layout.js — mobile-only логіка.
 *
 * Активується ТІЛЬКИ при window.innerWidth < 900 (matchMedia).
 * На desktop код заванажений але одразу exit'ить → нульовий ефект.
 *
 * Що робить:
 *   1. Rotation gate: на portrait phone показує overlay з проханням
 *      повернути на landscape. Автоматично приховує коли orientation
 *      змінюється. Кнопка "Все одно спробувати" → активує tabs mode.
 *   2. Tabs mode (fallback): додає 2 таби (📝 Код / 🎬 Сцена),
 *      перемикає видимість панелей, auto-switch при Run/Reset.
 *   3. Blockly resize після кожного tab switch (без цього блоки
 *      не перемальовуються під новий контейнер).
 *
 * НЕ ЧІПАЄ:
 *   • lesson-engine.js, simulator.js, main.js — жодного edit
 *   • Desktop layout — все у CSS media queries + JS gating
 */

(function () {
  'use strict';

  const MOBILE_QUERY = window.matchMedia('(max-width: 900px)');
  const PORTRAIT_QUERY = window.matchMedia('(orientation: portrait)');

  // Ранній exit для desktop — не робимо DOM injection зайвого
  if (!MOBILE_QUERY.matches) {
    console.log('[Mobile] Desktop viewport, mobile-layout disabled.');
    return;
  }

  console.log('[Mobile] Enabled (viewport ≤ 900px).');

  // ---------- Rotation Gate ----------
  function ensureRotationGate() {
    if (document.getElementById('rotation-gate')) return;

    const gate = document.createElement('div');
    gate.id = 'rotation-gate';
    gate.innerHTML = `
      <div id="rotation-gate__inner">
        <div id="rotation-gate__icon">📱</div>
        <p id="rotation-gate__text">
          Поверни телефон на бік — так буде зручніше писати команди для Мо 🐢
        </p>
        <button id="rotation-gate__fallback" type="button">
          Все одно спробувати →
        </button>
      </div>
    `;
    document.body.appendChild(gate);

    gate.querySelector('#rotation-gate__fallback').addEventListener('click', () => {
      console.log('[Mobile] Fallback tabs mode activated by user.');
      activateTabsMode();
      gate.classList.add('rotation-gate--dismissed');
    });
  }

  // Коли orientation міняється на landscape — гасимо dismissed-стан,
  // щоб gate знову спрацював якщо user знову перейде у portrait.
  function updateRotationGateVisibility() {
    if (!PORTRAIT_QUERY.matches) {
      // Landscape — прибираємо форсаж таб-режиму (opt-out), якщо був
      // Не деактивуємо .mobile-tabs-mode щоб не дезорієнтувати user'а,
      // якщо він вже переключився. Просто gate ховається завдяки CSS.
      const gate = document.getElementById('rotation-gate');
      if (gate) gate.classList.remove('rotation-gate--dismissed');
    }
  }

  PORTRAIT_QUERY.addEventListener('change', updateRotationGateVisibility);


  // ---------- Tabs Mode ----------
  const TABS = { CODE: 'code', SCENE: 'scene' };
  let tabsInjected = false;

  function ensureTabsDom() {
    if (tabsInjected) return;

    const tabsBar = document.createElement('div');
    tabsBar.id = 'mobile-tabs';
    tabsBar.innerHTML = `
      <button class="mobile-tab mobile-tab--active" data-tab="code" type="button">
        📝 Код
      </button>
      <button class="mobile-tab" data-tab="scene" type="button">
        🎬 Сцена
      </button>
    `;

    // Встромляємо між header і main
    const main = document.getElementById('app-main');
    if (main && main.parentNode) {
      main.parentNode.insertBefore(tabsBar, main);
    }

    tabsBar.querySelectorAll('.mobile-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    tabsInjected = true;
  }

  function activateTabsMode() {
    ensureTabsDom();
    document.body.classList.add('mobile-tabs-mode');
    switchTab(TABS.CODE);   // старт з коду
    hookRunResetAutoSwitch();
    showTabsIntroBubble();
  }

  function switchTab(tab) {
    // Body clas керує CSS видимістю панелей
    document.body.classList.remove('tab-code', 'tab-scene');
    document.body.classList.add(`tab-${tab}`);

    // Update tab buttons
    document.querySelectorAll('.mobile-tab').forEach(btn => {
      btn.classList.toggle('mobile-tab--active', btn.dataset.tab === tab);
    });

    // Blockly resize — без цього блоки не перемальовуються під новий контейнер
    if (tab === TABS.CODE && window.Blockly) {
      // requestAnimationFrame щоб CSS layout завершився перед svgResize
      requestAnimationFrame(() => {
        const ws = Blockly.getMainWorkspace && Blockly.getMainWorkspace();
        if (ws) Blockly.svgResize(ws);
      });
    }
  }

  // ---------- Auto-switch при Run / Reset ----------
  let autoSwitchHooked = false;
  function hookRunResetAutoSwitch() {
    if (autoSwitchHooked) return;

    const btnRun = document.getElementById('btn-run');
    const btnReset = document.getElementById('btn-reset');

    if (btnRun) {
      btnRun.addEventListener('click', () => {
        if (document.body.classList.contains('mobile-tabs-mode')) {
          switchTab(TABS.SCENE);   // на Run — переходимо на Сцену
        }
      });
    }
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (document.body.classList.contains('mobile-tabs-mode')) {
          switchTab(TABS.CODE);    // на Reset — назад на Код
        }
      });
    }

    autoSwitchHooked = true;
  }


  // ---------- Intro toast для tabs mode ----------
  // Одноразовий "onboarding" — показуємо тільки при першій активації.
  // Toast НАВМИСНО не використовує SpeechBubble engine'у — щоб не
  // тригерити 'lesson-next-click' event і не колізіювати з першим
  // beat'ом Мо, що уже підіймається знизу.
  //
  // Позиція: вгорі, під tabs bar. Bottom залишаємо для engine bubble.
  function showTabsIntroBubble() {
    if (localStorage.getItem('mobile_tabs_intro_shown') === '1') return;

    const toast = document.createElement('div');
    toast.id = 'mobile-tabs-intro-toast';
    toast.style.cssText = `
      position: fixed;
      top: 100px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      background: #fff;
      color: #2c2c2c;
      padding: 12px 18px;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
      z-index: 15000;
      max-width: 92vw;
      font-size: 14px;
      line-height: 1.4;
      border: 2px solid #4a9d4a;
      opacity: 0;
      transition: opacity 0.4s, transform 0.4s;
      pointer-events: auto;
      cursor: pointer;
    `;
    toast.innerHTML = `
      <strong>Дивись!</strong> Тут з'явились дві вкладки:<br>
      📝 <b>Код</b> — де ти пишеш команди для Мо,<br>
      🎬 <b>Сцена</b> — де побачиш що вийшло.
    `;
    document.body.appendChild(toast);

    // Плавна поява
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    const dismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(() => toast.remove(), 400);
      localStorage.setItem('mobile_tabs_intro_shown', '1');
    };

    // Tap → dismiss
    toast.addEventListener('click', dismiss);
    // Або auto-dismiss через 6 сек
    setTimeout(dismiss, 6000);
  }


  // ---------- Init ----------
  function init() {
    ensureRotationGate();
    updateRotationGateVisibility();
    // Tabs DOM створюємо ЛЕДЬ (тільки коли user натисне fallback),
    // щоб на нормальному landscape phone не було зайвих елементів.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Виставляємо у global для дебагу з DevTools
  window.MobileLayout = {
    activateTabsMode,
    switchTab,
    TABS
  };
})();
