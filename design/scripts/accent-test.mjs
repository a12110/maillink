// 校验 theme.js 的强调色派生：accent / fg / hover / active / text，对 surface 与 bg 都要达标。
// 运行：node design/scripts/accent-test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const src = read('../prototypes/theme.js');
const body = src.slice(src.indexOf('var STEPS'), src.indexOf('function read'));
const { deriveAccent, ensure, contrast } = new Function(`var INK = '#1f1d1a'; ${body}; return { deriveAccent, ensure, contrast };`)();

const css = read('../../apps/web/src/styles/tokens.css');
const tok = (sel, name) => css.match(new RegExp(sel.replace(/[[\]"]/g, '\\$&') + '\\s*\\{[\\s\\S]*?--' + name + ':\\s*(#[0-9a-f]{6})'))[1];
const grounds = {
  light: { surface: tok(':root', 'color-surface'), bg: tok(':root', 'color-bg') },
  dark: { surface: tok('[data-theme="dark"]', 'color-surface'), bg: tok('[data-theme="dark"]', 'color-bg') },
};

const worst = { accentSurface: 99, accentBg: 99, fg: 99, hover: 99, active: 99, textSurface: 99, textBg: 99 };
const note = (k, v, tag) => { if (v < worst[k]) { worst[k] = v; worst[k + 'At'] = tag; } };
let bad = 0, n = 0;

function run(hex, mode) {
  const { surface, bg } = grounds[mode];
  const d = deriveAccent(hex, surface, bg, mode === 'dark');
  const r = {
    accentSurface: contrast(d.accent, surface), accentBg: contrast(d.accent, bg),
    fg: contrast(d.fg, d.accent), hover: contrast(d.fg, d.hover), active: contrast(d.fg, d.active),
    textSurface: contrast(d.text, surface), textBg: contrast(d.text, bg),
  };
  const need = { accentSurface: 3, accentBg: 3, fg: 4.5, hover: 4.5, active: 4.5, textSurface: 4.5, textBg: 4.5 };
  n++;
  for (const k of Object.keys(r)) { note(k, r[k], `${hex}/${mode}`); if (r[k] < need[k]) { bad++; console.log('FAIL', hex, mode, k, r[k].toFixed(2)); break; } }
}

const swatches = ['#c8432b', '#2f5fa8', '#1f7a5a', '#d9a21b', '#3a3632', '#ffff00', '#ffffff', '#000000', '#7a7a7a', '#00ffff', '#ff00ff'];
for (const hex of swatches) for (const mode of ['light', 'dark']) run(hex, mode);

// 随机 + 网格采样
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
for (let i = 0; i < 4000; i++) {
  const hex = '#' + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
  for (const mode of ['light', 'dark']) run(hex, mode);
}

// 做不到时必须抛错，不能静默返回
let threw = false;
try { ensure('#888888', [grounds.light.surface], 25, '#1f1d1a', 'accent'); } catch (e) { threw = true; }
if (!threw) { bad++; console.log('FAIL ensure() 在目标不可达时没有抛错'); }

console.log(`检查 ${n} 组（${swatches.length} 个预设色 + 4000 个随机色，各浅/深）`);
console.log('最差值（要求）：');
console.log(`  accent 对 surface ${worst.accentSurface.toFixed(2)} (≥3)   对 bg ${worst.accentBg.toFixed(2)} (≥3)`);
console.log(`  fg 对 accent ${worst.fg.toFixed(2)} (≥4.5)   fg 对 hover ${worst.hover.toFixed(2)} (≥4.5)   fg 对 active ${worst.active.toFixed(2)} (≥4.5)`);
console.log(`  accent-text 对 surface ${worst.textSurface.toFixed(2)} (≥4.5)   对 bg ${worst.textBg.toFixed(2)} (≥4.5)`);
console.log(`  ensure() 目标不可达时抛错：${threw ? '是' : '否'}`);
console.log(bad ? `${bad} 项失败` : '全部通过');
process.exitCode = bad ? 1 : 0;
