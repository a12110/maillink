// 解析 apps/web/src/styles/tokens.css，检查关键颜色对的 WCAG 对比度。运行：node design/scripts/contrast.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../../apps/web/src/styles/tokens.css', import.meta.url)), 'utf8');
const block = (sel) => {
  const m = css.match(new RegExp(sel.replace(/[[\]"]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}'));
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((x) => ['--' + x[1], x[2]]));
};
const light = block(':root');
const dark = { ...light, ...block('[data-theme="dark"]') };

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const L = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// 与 CSS color-mix(in srgb, a (1-t), b t) 一致
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

// hover / active：CSS 里是 color-mix(accent 88% / 78%, var(--color-accent-mix))
for (const t of [light, dark]) {
  t['--color-accent-hover'] = mix(t['--color-accent'], t['--color-accent-mix'], 0.12);
  t['--color-accent-active'] = mix(t['--color-accent'], t['--color-accent-mix'], 0.22);
}

const grounds = ['--color-bg', '--color-surface', '--color-row-alt', '--color-row-hover', '--color-row-selected', '--color-surface-sunken'];
const checks = [
  // [前景, 背景, 最低]，4.5 = 正文，3 = 非文字组件
  ...grounds.flatMap((b) => [['--color-text', b, 4.5], ['--color-text-muted', b, 4.5]]),
  // subtle 用在 bg / surface / 斑马 / 选中 / 凹陷面上都要过
  ...grounds.filter((b) => b !== '--color-surface-sunken' || true).map((b) => ['--color-text-subtle', b, 4.5]),
  ['--color-accent-fg', '--color-accent', 4.5], ['--color-accent-fg', '--color-accent-hover', 4.5], ['--color-accent-fg', '--color-accent-active', 4.5],
  ['--color-accent', '--color-surface', 3], ['--color-accent', '--color-bg', 3],
  ['--color-accent-text', '--color-surface', 4.5], ['--color-accent-text', '--color-bg', 4.5],
  ['--color-text', '--color-accent-soft', 4.5],
  ['--color-danger', '--color-surface', 4.5], ['--color-danger', '--color-danger-soft', 4.5], ['--color-danger-fg', '--color-danger', 4.5],
  ['--color-success-text', '--color-surface', 4.5], ['--color-success', '--color-surface', 3],
  ['--color-warning', '--color-surface', 4.5], ['--color-warning', '--color-warning-soft', 4.5],
  ['--color-info', '--color-surface', 4.5], ['--color-info', '--color-info-soft', 4.5],
  // 控件边框、状态点要在各种行底上都 ≥ 3:1
  ...['--color-surface', '--color-bg', '--color-row-alt', '--color-row-selected', '--color-surface-sunken'].flatMap((b) => [
    ['--color-border-control', b, 3], ['--color-neutral-dot', b, 3]]),
  ['--color-focus', '--color-surface', 3], ['--color-focus', '--color-bg', 3], ['--color-focus', '--color-row-selected', 3],
  ['--color-selected-fg', '--color-selected', 4.5],
];

let fail = 0, n = 0;
for (const [name, t] of [['light', light], ['dark', dark]]) {
  // accent-soft 是 accent 与 surface 的混合
  t['--color-accent-soft'] = mix(t['--color-surface'], t['--color-accent'], name === 'light' ? 0.11 : 0.18);
  console.log(`-- ${name}`);
  for (const [f, b, min] of checks) {
    const r = ratio(t[f], t[b]);
    const ok = r >= min;
    n++;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)} (≥${min}) ${f} ${t[f]} on ${b} ${t[b]}`);
  }
}
console.log(fail ? `\n${fail} / ${n} 项不达标` : `\n全部达标（${n} 项）`);
process.exitCode = fail ? 1 : 0;
