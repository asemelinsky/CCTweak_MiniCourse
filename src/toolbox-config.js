/**
 * toolbox-config.js — прогресивне розкриття Blockly toolbox по уроках.
 *
 * Педагогічне обґрунтування:
 *   • L1-L2 показуємо ТІЛЬКИ 4 блоки руху — щоб не було silent-fail
 *     (дитина потягне repeat, воно нічого не робить, «я щось зіпсувала»)
 *   • L3 з'являється категорія «Цикли» — це MOMENT відкриття, драматургія
 *   • L4+ додаємо if/sensor/логіку — по одній категорії за раз
 *   • L6+ у ту саму «Цикли» додається loop_while_not_diamond
 *     (LB-012 2026-08-20: НЕ окрема категорія «Умовні цикли» —
 *      concept «цикл» = один; while це просто інший вид повторення)
 *
 * ⚠️ WHITELIST-правило (LB-013 2026-08-20):
 *   Кожна категорія містить ТІЛЬКИ блоки що вивчені у поточному або
 *   попередніх уроках цього мінікурсу. НЕ додавати Blockly-стандартні
 *   блоки що не викладаються (напр. logic_compare, controls_whileUntil,
 *   controls_if native, math_arithmetic тощо). Дитина відкриє категорію
 *   → бачить тільки знайомі блоки, без «silent засмічення» невідомими.
 *
 * Дизайн: docs/teaching-patterns.md § "Anti-patterns", design-doc §3.2
 *
 * Використання: main.js викликає getToolboxXml(lessonId) → отримує
 * готовий XML string, передає у Blockly.inject().
 */

const TOOLBOX_CONFIG = {
  // L1, L2 — тільки рух. Мінімальний toolbox.
  l1: ['movement'],
  l2: ['movement'],
  // L3 — з'являється Цикли (repeat). Числа теж (для параметра N).
  l3: ['movement', 'loops', 'numbers'],
  // L4 — sensor + if (тільки condition_if_else, whitelist).
  l4: ['movement', 'loops', 'numbers', 'sensors', 'logic'],
  // L5 debug — ті самі блоки що L4, вправа інша.
  l5: ['movement', 'loops', 'numbers', 'sensors', 'logic'],
  // L6 — у категорію «Цикли» додається loop_while_not_diamond.
  l6: ['movement', 'loops', 'numbers', 'sensors', 'logic'],
  // L7 — все (та ж категорія «Цикли» з двома блоками, whitelist logic).
  l7: ['movement', 'loops', 'numbers', 'sensors', 'logic'],
};

/**
 * CATEGORIES — mapping key → XML string OR (lessonId) => XML string.
 * Function-value дозволяє dynamic content залежно від уроку
 * (напр. «Цикли» у L3 = тільки repeat, у L6+ = repeat + while).
 */
const CATEGORIES = {
  movement: `<category name="Рух" colour="120">
      <block type="turtle_forward"></block>
      <block type="turtle_back"></block>
      <block type="turtle_up"></block>
      <block type="turtle_down"></block>
    </category>`,

  // LB-012: одна категорія «Цикли» з dynamic content.
  // L3-L5: тільки repeat. L6-L7: repeat + loop_while_not_diamond.
  // Дитина ментально не розділяє «цикл» vs «умовний цикл» — обидва просто повторення.
  loops: (lessonId) => {
    const includeWhile = ['l6', 'l7'].includes(lessonId);
    const whileBlock = includeWhile
      ? '\n      <block type="loop_while_not_diamond"></block>'
      : '';
    return `<category name="Цикли" colour="290">
      <block type="controls_repeat_ext">
        <value name="TIMES">
          <shadow type="math_number">
            <field name="NUM">3</field>
          </shadow>
        </value>
      </block>${whileBlock}
    </category>`;
  },

  sensors: `<category name="Сенсори" colour="180">
      <block type="sensor_wall_ahead"></block>
    </category>`,

  // LB-013: тільки condition_if_else (наш custom, вивчається у L4).
  // Прибрано Blockly-native: controls_if, logic_compare, logic_operation,
  // logic_boolean — вони не викладаються у мінікурсі. Whitelist-правило.
  logic: `<category name="Логіка" colour="210">
      <block type="condition_if_else"></block>
    </category>`,

  numbers: `<category name="Числа" colour="230">
      <block type="math_number"></block>
    </category>`,
};

/**
 * Повертає toolbox XML string для конкретного уроку.
 * Fallback: якщо lessonId невідомий — повертаємо l1 конфігурацію (мінімальну).
 * Category-value може бути string (static) або function(lessonId) (dynamic).
 */
function getToolboxXml(lessonId) {
  const categoryKeys = TOOLBOX_CONFIG[lessonId] || TOOLBOX_CONFIG.l1;
  const categoriesXml = categoryKeys
    .filter(key => CATEGORIES[key])   // graceful skip невідомих
    .map(key => {
      const entry = CATEGORIES[key];
      return typeof entry === 'function' ? entry(lessonId) : entry;
    })
    .join('\n    ');
  return `<xml id="toolbox" style="display:none">
    ${categoriesXml}
  </xml>`;
}

// Експорт у window для main.js
window.ToolboxConfig = { getToolboxXml, TOOLBOX_CONFIG };
