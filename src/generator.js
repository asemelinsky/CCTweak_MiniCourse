/**
 * JavaScript-генератор для наших custom-блоків.
 *
 * Blockly генерує JS-код (не Lua), бо ми виконуємо його у JS-Interpreter sandbox
 * (для автоматичної перевірки коректності). Реальний Lua експорт у Minecraft —
 * окрема задача (не в MVP).
 *
 * Другий аргумент кожного виклику — ID блоку. Потрібен для підсвітки блоку
 * під час анімації.
 */

'use strict';

Blockly.JavaScript.forBlock['turtle_forward'] = function(block) {
  return `turtleForward('${block.id}');\n`;
};

Blockly.JavaScript.forBlock['turtle_back'] = function(block) {
  return `turtleBack('${block.id}');\n`;
};

Blockly.JavaScript.forBlock['turtle_up'] = function(block) {
  return `turtleUp('${block.id}');\n`;
};

Blockly.JavaScript.forBlock['turtle_down'] = function(block) {
  return `turtleDown('${block.id}');\n`;
};

// L4 sensor — value block (Boolean). Повертає [expr, precedence] tuple —
// Blockly convention для value blocks (не statement).
Blockly.JavaScript.forBlock['sensor_wall_ahead'] = function(block) {
  return [`sensorWallAhead('${block.id}')`, Blockly.JavaScript.ORDER_FUNCTION_CALL];
};

// L4 atomic «якщо/то/інакше» — статичні 3 слоти (без mutator).
// Генеруємо стандартний if-else JS блок.
Blockly.JavaScript.forBlock['condition_if_else'] = function(block) {
  const cond = Blockly.JavaScript.valueToCode(
    block, 'COND', Blockly.JavaScript.ORDER_NONE
  ) || 'false';
  const thenCode = Blockly.JavaScript.statementToCode(block, 'THEN');
  const elseCode = Blockly.JavaScript.statementToCode(block, 'ELSE');
  return `if (${cond}) {\n${thenCode}} else {\n${elseCode}}\n`;
};

// L6 «поки не на алмазі — робити». Semantics вбудована — sensor автоматично.
// Захист від нескінченного циклу — safety timeout у simulator (10000 steps).
Blockly.JavaScript.forBlock['loop_while_not_diamond'] = function(block) {
  const body = Blockly.JavaScript.statementToCode(block, 'DO');
  return `while (!sensorOnDiamond()) {\n${body}}\n`;
};

// Reserved words щоб Blockly не використав API-імена для user variables
Blockly.JavaScript.addReservedWords('turtleForward,turtleBack,turtleUp,turtleDown,sensorWallAhead,sensorOnDiamond,highlightBlock');
