/* 原型用主题切换：data-theme / data-radius / 强调色。
 * 强调色派生规则（正式实现照搬，测试在 design/scripts/accent-test.mjs）：
 *   1. accent：对 surface 和 bg 的对比度都 ≥ 3:1；不足时向墨色（浅色）/ 白色（深色）混合，直到两者都达标
 *   2. accent-fg：在 #ffffff 与 #000000 里取对比度更高的，最差 4.58:1（任何底色都成立）
 *   3. accent-mix：fg 为白 → #000000，fg 为黑 → #ffffff；hover = accent 混 12%、active = 混 22%，
 *      方向保证 fg 对比度只增不减，仍逐项校验 ≥ 4.5:1
 *   4. accent-text（强调色作文字）：对 surface 和 bg 都 ≥ 4.5:1，同样向墨色/白色混合
 *   任一步在混到纯墨/纯白后仍不达标，直接抛错，不返回未达标的颜色。
 * URL 参数 ?theme=dark&radius=8&accent=%232f5fa8 优先于上次保存的值。 */
(function () {
  var root = document.documentElement;
  var INK = '#1f1d1a';
  var DEFAULT_ACCENT = '#c8432b';
  var KEY = 'maillink-ui0';
  var STEPS = 25;

  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function rgbToHex(c) { return '#' + c.map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join(''); }
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(h) { var c = hexToRgb(h); return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { var p = hexToRgb(a), q = hexToRgb(b); return rgbToHex(p.map(function (v, i) { return v + (q[i] - v) * t; })); }
  function atLeast(color, grounds, target) { return grounds.every(function (g) { return contrast(color, g) >= target; }); }
  function ensure(color, grounds, target, toward, label) {
    for (var i = 0; i <= STEPS; i++) {
      var out = mix(color, toward, i / STEPS);
      if (atLeast(out, grounds, target)) return out;
    }
    throw new Error('无法把 ' + (label || color) + ' 调到对 ' + grounds.join('、') + ' 的对比度 ≥ ' + target + ':1');
  }
  function deriveAccent(hex, surface, bg, dark) {
    var toward = dark ? '#ffffff' : INK;
    var grounds = [surface, bg];
    var accent = ensure(hex, grounds, 3, toward, 'accent');
    var fg = contrast(accent, '#ffffff') >= contrast(accent, '#000000') ? '#ffffff' : '#000000';
    var target = fg === '#ffffff' ? '#000000' : '#ffffff';
    var hover = mix(accent, target, 0.12);
    var active = mix(accent, target, 0.22);
    [accent, hover, active].forEach(function (c) {
      if (contrast(fg, c) < 4.5) throw new Error('强调色 ' + c + ' 上的前景 ' + fg + ' 对比度 < 4.5:1');
    });
    return { accent: accent, fg: fg, mix: target, hover: hover, active: active, text: ensure(accent, grounds, 4.5, toward, 'accent-text') };
  }
  function read(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  var ACCENT_VARS = ['--color-accent', '--color-accent-fg', '--color-accent-text', '--color-accent-mix'];
  function applyAccent(hex) {
    var style = root.style;
    ACCENT_VARS.forEach(function (k) { style.removeProperty(k); });
    root.removeAttribute('data-accent');
    if (!hex || hex.toLowerCase() === DEFAULT_ACCENT) return;
    var d = deriveAccent(hex, read('--color-surface'), read('--color-bg'), root.getAttribute('data-theme') === 'dark');
    style.setProperty('--color-accent', d.accent);
    style.setProperty('--color-accent-fg', d.fg);
    style.setProperty('--color-accent-text', d.text);
    style.setProperty('--color-accent-mix', d.mix);
    root.setAttribute('data-accent', d.accent);
  }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 无存储时只在当前页生效 */ } }

  var q = new URLSearchParams(location.search);
  var state = Object.assign({ theme: 'light', radius: '4', accent: DEFAULT_ACCENT }, load());
  ['theme', 'radius', 'accent'].forEach(function (k) { if (q.get(k)) state[k] = q.get(k); });

  function apply() {
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-radius', state.radius);
    applyAccent(state.accent);
    document.querySelectorAll('[data-set]').forEach(function (el) {
      var pair = el.getAttribute('data-set').split(':');
      var on = state[pair[0]] === pair.slice(1).join(':');
      if (el.tagName === 'INPUT') el.checked = on; else el.setAttribute('aria-pressed', String(on));
    });
  }

  apply();
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    document.addEventListener('click', function (e) {
      var el = e.target.closest('button[data-set]');
      if (!el) return;
      var pair = el.getAttribute('data-set').split(':');
      state[pair[0]] = pair.slice(1).join(':');
      save(state); apply();
    });
    document.addEventListener('change', function (e) {
      var el = e.target.closest('input[data-set]');
      if (!el || !el.checked) return;
      var pair = el.getAttribute('data-set').split(':');
      state[pair[0]] = pair.slice(1).join(':');
      save(state); apply();
    });
  });
})();
