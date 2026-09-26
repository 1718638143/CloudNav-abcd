// 拼音首字母匹配工具：零依赖，基于 GB2312 区位码计算常用汉字的拼音首字母，
// 英文/数字原样保留，供全站搜索做多音节模糊匹配。
// JS 字符串是 Unicode，所以先通过离线生成的 GB2312 一级字表反查区位码，再查拼音分界表。
import { GB2312_LEVEL1 } from './gb2312Level1';

// 区位码 → 拼音首字母分界表（升序，GB2312 一级汉字按拼音排序的 23 个分段）
const BOUNDARY: number[] = [
  0xB0A1, // 区起点
  0xB0C5, // A
  0xB2C1, // B
  0xB4EE, // C
  0xB6EA, // D
  0xB7A2, // E
  0xB8C1, // F
  0xB9FE, // G
  0xBBF7, // H
  0xBBF7, // (占位对齐)
  0xBFA6, // J
  0xC0AC, // K
  0xC2E8, // L
  0xC4C3, // M
  0xC5B6, // N
  0xC5BE, // O
  0xC6DA, // P
  0xC8BB, // Q
  0xC8F6, // R
  0xCBFA, // S
  0xCDD9, // T
  0xCEF4, // W
  0xD1B9, // X
  0xD4D1, // Y
  0xD7FA, // Z
];

// 与 BOUNDARY 分段一一对应的字母（GB2312 一级字库无 I/O/U/V 开头的常用字）
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// 汉字 → 区位下标（模块加载时建一次，避免每次 indexOf 扫描 3755 字）
const charIndex = new Map<string, number>();
for (let i = 0; i < GB2312_LEVEL1.length; i++) charIndex.set(GB2312_LEVEL1[i], i);

// 汉字 → 首字母缓存（初始化一次，之后 O(1) 查询）
const initialCache = new Map<string, string>();

/** 获取单个字符的拼音首字母；非一级常用字原样返回小写 */
export function getInitial(char: string): string {
  const cached = initialCache.get(char);
  if (cached !== undefined) return cached;

  let result: string;
  const idx = charIndex.get(char) ?? -1;
  if (idx === -1) {
    result = char.toLowerCase();
  } else {
    // 表按区位码顺序排列：区码从 0xB0 开始，每区最多 94 个位
    const zone = 0xB0 + Math.floor(idx / 94);
    const pos = 0xA1 + (idx % 94);
    const code = (zone << 8) | pos;
    result = char.toLowerCase();
    for (let i = 1; i < BOUNDARY.length; i++) {
      if (code < BOUNDARY[i]) {
        result = LETTERS[i - 1].toLowerCase();
        break;
      }
    }
  }
  initialCache.set(char, result);
  return result;
}

/** 返回字符串的拼音首字母串，如 "搜索引擎" -> "ssyq"，"GitHub" -> "github" */
export function getInitials(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (charIndex.has(ch)) {
      result += getInitial(ch);
    } else if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
      result += ch.toLowerCase();
    }
    // 其他字符（空格、符号、生僻字）跳过
  }
  return result;
}

/**
 * 检查文本是否匹配查询：把文本转成拼音首字母串（汉字取首字母，英文数字保留），
 * 判断查询串（去空格）是否为其子串。适用于输入 "ssyq" 找 "搜索引擎" 这类场景。
 */
export function matchPinyinInitials(text: string, query: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q || !/[a-z]/.test(q)) return false;
  // 只在查询为纯 ASCII 字母/数字时才走拼音匹配，避免中文查询重复计算
  if (!/^[a-z0-9]+$/.test(q)) return false;
  return getInitials(text).includes(q);
}
