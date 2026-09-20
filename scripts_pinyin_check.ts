import { getInitials, matchPinyinInitials } from './services/pinyinService';

const cases: [string, string, boolean][] = [
  ['搜索引擎', 'ssyq', true],
  ['开发工具', 'gf', true],
  ['搜索引擎', 'xyz', false],
  ['GitHub', 'gith', true],
  ['人工智能', 'rgzn', true],
  ['即时资讯', 'jszx', true],
  ['休闲娱乐', 'yule', false], // 'yule' 是全拼不是首字母，不应匹配
];

let pass = 0;
for (const [text, q, expected] of cases) {
  const got = matchPinyinInitials(text, q);
  const ok = got === expected;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  matchPinyinInitials('${text}','${q}') = ${got} (期望 ${expected})`);
}
console.log(`getInitials('搜索引擎') = ${getInitials('搜索引擎')}`);
console.log(`getInitials('开发工具') = ${getInitials('开发工具')}`);
console.log(`getInitials('GitHub') = ${getInitials('GitHub')}`);
console.log(`${pass}/${cases.length} 通过`);
if (pass !== cases.length) process.exit(1);
