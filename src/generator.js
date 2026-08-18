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

// Reserved words щоб Blockly не використав API-імена для user variables
Blockly.JavaScript.addReservedWords('turtleForward,turtleBack,turtleUp,turtleDown,sensorWallAhead,highlightBlock');
