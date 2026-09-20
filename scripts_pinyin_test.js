var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var pinyinService_exports = {};
__export(pinyinService_exports, {
  getInitial: () => getInitial,
  getInitials: () => getInitials,
  matchPinyinInitials: () => matchPinyinInitials
});
module.exports = __toCommonJS(pinyinService_exports);
const BOUNDARY = [
  45217,
  // 区起点
  45253,
  // A
  45761,
  // B
  46318,
  // C
  46826,
  // D
  47010,
  // E
  47297,
  // F
  47614,
  // G
  48119,
  // H
  48119,
  // (占位对齐)
  49062,
  // J
  49324,
  // K
  49896,
  // L
  50371,
  // M
  50614,
  // N
  50622,
  // O
  50906,
  // P
  51387,
  // Q
  51446,
  // R
  52218,
  // S
  52697,
  // T
  52980,
  // W
  53689,
  // X
  54481,
  // Y
  55290
  // Z
];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
function getInitial(char) {
  const code = char.charCodeAt(0);
  if (code < 45217 || code > 55290) return char.toLowerCase();
  for (let i = 1; i < BOUNDARY.length; i++) {
    if (code < BOUNDARY[i]) {
      return LETTERS[i - 1].toLowerCase();
    }
  }
  return char.toLowerCase();
}
function getInitials(text) {
  let result = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 45217 && code <= 55290) {
      result += getInitial(ch);
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      result += ch.toLowerCase();
    }
  }
  return result;
}
function matchPinyinInitials(text, query) {
  const initials = getInitials(text);
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return false;
  return initials.includes(q);
}
