/**
 * toolbox-config.js — прогресивне розкриття Blockly toolbox по уроках.
 *
 * Педагогічне обґрунтування:
 *   • L1-L2 показуємо ТІЛЬКИ 4 блоки руху — щоб не було silent-fail
 *     (дитина потягне repeat, воно нічого не робить, «я щось зіпсувала»)
 *   • L3 з'являється категорія «Цикли» — це MOMENT відкриття, драматургія
 *   • L4+ додаємо if/sensor/логіку — по одній категорії за раз
 *
 * Дизайн: docs/teaching-patterns.md § "Anti-patterns"
 * (уникаємо перевантаження toolbox'у, зайвих блоків, silent fails).
 *
 * Використання: main.js викликає getToolboxXml(lessonId) → отримує
 * готовий XML string, передає у Blockly.inject().
 */

const TOOLBOX_CONFIG = {
  // L1, L2 — тільки рух. Мінімальний toolbox.
  l1: ['movement'],
  l2: ['movement'],
  // L3 — з'являється Цикли. Числа теж (для параметра N у repeat).
  l3: ['movement', 'loops-count', 'numbers'],
  // L4 — sensor + if.
  l4: ['movement', 'loops-count', 'numbers', 'sensors', 'logic'],
  // L5 debug — ті самі блоки що L4, вправа інша.
  l5: ['movement', 'loops-count', 'numbers', 'sensors', 'logic'],
  // L6 — додається while.
  l6: ['movement', 'loops-count', 'loops-while', 'numbers', 'sensors', 'logic'],
  // L7 — все.
  l7: ['movement', 'loops-count', 'loops-while', 'numbers', 'sensors', 'logic'],
};

// Категорії з їхніми блоками. Кожна категорія — ключ вище.
// Розбиваємо `loops` на `loops-count` (repeat) і `loops-while` (while) —
// щоб не показувати while у L3 (воно поки не потрібне).
const CATEGORIES = {
  movement: `<category name="Рух" colour="120">
      <block type="turtle_forward"></block>
      <block type="turtle_back"></block>
      <block type="turtle_up"></block>
      <block type="turtle_down"></block>
    </category>`,

  'loops-count': `<category name="Цикли" colour="290">
      <block type="controls_repeat_ext">
        <value name="TIMES">
          <shadow type="math_number">
            <field name="NUM">3</field>
          </shadow>
        </value>
      </block>
    </category>`,

  'loops-while': `<category name="Умовні цикли" colour="290">
      <block type="controls_whileUntil">
        <field name="MODE">WHILE</field>
      </block>
    </category>`,

  sensors: `<category name="Сенсори" colour="180">
      <block type="sensor_wall_ahead"></block>
    </category>`,

  logic: `<category name="Логіка" colour="210">
      <block type="controls_if"></block>
      <block type="logic_compare"></block>
      <block type="logic_operation"></block>
      <block type="logic_boolean"></block>
    </category>`,

  numbers: `<category name="Числа" colour="230">
      <block type="math_number"></block>
    </category>`,
};

/**
 * Повертає toolbox XML string для конкретного уроку.
 * Fallback: якщо lessonId невідомий — повертаємо l1 конфігурацію (мінімальну).
 */
function getToolboxXml(lessonId) {
  const categoryKeys = TOOLBOX_CONFIG[lessonId] || TOOLBOX_CONFIG.l1;
  const categoriesXml = categoryKeys
    .filter(key => CATEGORIES[key])   // graceful skip невідомих (напр. sensors ще не написаний)
    .map(key => CATEGORIES[key])
    .join('\n    ');
  return `<xml id="toolbox" style="display:none">
    ${categoriesXml}
  </xml>`;
}

// Експорт у window для main.js
window.ToolboxConfig = { getToolboxXml, TOOLBOX_CONFIG };
