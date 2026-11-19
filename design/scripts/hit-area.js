// 取件页命中区检查：在浏览器控制台（或 browser.evaluate）里对 pickup-*.html 运行，返回所有可点元素的可见尺寸与命中尺寸。
// 命中尺寸 = max(元素盒子, 绝对定位的 ::after 伪元素)；全部 ok 才算过（≥44×44）。
(() => {
  const sel = '.pk-page a, .pk-page button, .pk-page summary, .pk-page input, .pk-page select';
  const rows = [];
  document.querySelectorAll(sel).forEach((el) => {
    if (el.closest('.devbar')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(el, '::after');
    const ext = cs.content !== 'none' && cs.position === 'absolute';
    const w = Math.max(r.width, ext ? parseFloat(cs.width) : 0);
    const h = Math.max(r.height, ext ? parseFloat(cs.height) : 0);
    rows.push({ text: (el.innerText || el.getAttribute('aria-label') || el.placeholder || el.tagName).trim().slice(0, 16), visible: `${Math.round(r.width)}x${Math.round(r.height)}`, hit: `${Math.round(w)}x${Math.round(h)}`, ok: w >= 43.5 && h >= 43.5 });
  });
  return { total: rows.length, failing: rows.filter((x) => !x.ok), rows };
})();
