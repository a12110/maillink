// 把 src/*.html 里的占位符替换成共享片段，输出到同级目录（design/prototypes/*.html）。运行：node design/prototypes/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const icons = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  funnel: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  'file-text': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.41l8.7 8.71a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="m15 3 6 0 0 6"/><path d="M10 14 21 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  'file-x': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M9.5 12.5l5 5M14.5 12.5l-5 5"/>',
  'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
};

const sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' +
  Object.entries(icons).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('') + '</svg>';

export const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const radio = (name, key, val, label) =>
  `<label><input type="radio" name="${name}" data-set="${key}:${val}"><span>${label}</span></label>`;
const swatch = (hex, label) =>
  `<button type="button" class="swatch" style="background:${hex}" data-set="accent:${hex}" aria-label="强调色 ${label}" title="${label}"></button>`;
const devInner = (id) => `
  <div class="row"><span>明暗</span><div class="segmented segmented-sm">${radio(id + 't', 'theme', 'light', '浅')}${radio(id + 't', 'theme', 'dark', '深')}</div></div>
  <div class="row"><span>圆角</span><div class="segmented segmented-sm">${radio(id + 'r', 'radius', '0', '0')}${radio(id + 'r', 'radius', '4', '4')}${radio(id + 'r', 'radius', '8', '8')}</div></div>
  <div class="row"><span>强调色</span><div class="swatches">${swatch('#c8432b', '邮戳红')}${swatch('#2f5fa8', '靛蓝')}${swatch('#1f7a5a', '松绿')}${swatch('#d9a21b', '琥珀')}${swatch('#3a3632', '墨')}</div></div>`;

const devbarInline = `<div class="devbar" aria-label="原型主题控件（非产品）">${devInner('i')}</div>`;
const devbarFloat = (sim) => `<details class="devbar devbar-float"><summary>主题 ▾</summary><div class="body">${devInner('f')}${sim ? '<div class="row"><button type="button" class="btn btn-secondary btn-sm" data-sim="new">模拟新邮件到达</button></div>' : ''}</div></details>`;

const nav = [
  ['邮件', [
    ['mailboxes', '收件地址', 'mail', 'mailboxes.html'],
    ['links', '取件链接', 'link', '#'],
    ['rules', '规则组', 'funnel', 'rule-group-edit.html'],
    ['mails', '全部邮件', 'inbox', '#'],
  ]],
  ['管理', [
    ['users', '用户', 'users', '#'],
    ['settings', '系统设置', 'sliders', '#'],
    ['audit', '审计日志', 'file-text', '#'],
  ]],
];

const sidebar = (current) => `<aside class="sidebar">
  <div class="brand"><span class="brand-mark">${icon('mail')}</span><span class="brand-name">MailLink</span></div>
  <nav aria-label="主导航">
${nav.map(([label, items]) => `    <div class="nav-label">${label}</div>
${items.map(([id, text, ic, href]) => `    <a class="nav-item" href="${href}"${id === current ? ' aria-current="page"' : ''}>${icon(ic)}${text}</a>`).join('\n')}`).join('\n')}
  </nav>
  <div class="sidebar-foot">
    ${devbarInline}
    <div class="user-chip"><span class="avatar">A</span><span><b>admin</b><small>管理员 · 账号安全</small></span></div>
  </div>
</aside>`;

// 收件地址样例：覆盖启用/停用、无备注、无标签、从未来信、超长别名、标签溢出
const mailboxes = [
  ['swift_lantern_7k2q9x@icloud.com', 'OpenAI 共享号 #12', ['OpenAI', '共享'], 1, 2, 0, '11-20 14:32', true],
  ['quiet_maple_3m8d1c@icloud.com', 'OpenAI 买断 · 订单 A20311', ['OpenAI', '买断'], 1, 1, 1, '11-20 14:05'],
  ['amber_otter_x92kfd@icloud.com', 'Anthropic 共享号 #04', ['Anthropic', '共享'], 1, 3, 0, '11-20 13:48', true],
  ['brisk_falcon_41zq0e@icloud.com', '', ['Netflix'], 1, 0, 0, '11-19 21:07'],
  ['velvet_harbor_t5n7w2@icloud.com', 'Steam 买断 · 质保至 12-30', ['Steam', '买断'], 1, 1, 0, '11-19 18:22'],
  ['pale_comet_9d3rh6@icloud.com', '已退款，待回收', ['OpenAI'], 0, 0, 0, '11-18 09:41'],
  ['northern_crisp_walnut_a8e4m1v7@icloud.com', 'Google 共享号 · 超长别名，列内省略号截断', ['Google', '共享', '备货', '待核对'], 1, 1, 0, '11-18 23:56'],
  ['lunar_pine_0w6xjc@icloud.com', 'Discord', ['Discord'], 1, 1, 0, '11-18 22:10'],
  ['mellow_cedar_5b1p8y@icloud.com', 'Spotify 家庭组', ['Spotify', '共享'], 1, 1, 2, '11-17 16:55'],
  ['ivory_ember_k27vq4@icloud.com', '', [], 1, 0, 0, ''],
  ['hazel_river_6f9s2t@icloud.com', 'Microsoft 共享号 #03', ['Microsoft', '共享'], 1, 2, 0, '11-17 08:30'],
  ['crimson_wren_d4h7n0@icloud.com', 'Apple ID 买断', ['Apple', '买断'], 1, 1, 0, '11-16 20:18'],
  ['tidy_birch_m3x8c5@icloud.com', 'OpenAI 共享号 #13', ['OpenAI', '共享'], 1, 2, 0, '11-16 12:02', true],
  ['gentle_aspen_2r5k9u@icloud.com', '停用：平台封号', ['Netflix'], 0, 0, 0, '11-12 19:44'],
  ['solar_juniper_8c0v3z@icloud.com', 'Anthropic 买断 · 订单 A20377', ['Anthropic', '买断'], 1, 1, 1, '11-15 10:27'],
  ['misty_quartz_7j4t1b@icloud.com', '备货，未售出', ['OpenAI', '备货'], 1, 1, 0, '11-14 15:03'],
];
const rows = mailboxes.map(([addr, note, tags, on, links, users, last, sel]) => `
          <tr${sel ? ' aria-selected="true"' : ''}>
            <td class="col-check"><input type="checkbox" class="cb row-cb" aria-label="选择 ${addr}"${sel ? ' checked' : ''}></td>
            <td class="addr" title="${addr}">${addr}</td>
            <td${note ? '' : ' class="dim"'} title="${note}">${note || '—'}</td>
            <td class="cell-tags"><div class="tags">${tags.length ? tags.slice(0, 3).map((t) => `<span class="tag">${t}</span>`).join('') + (tags.length > 3 ? `<span class="tag">+${tags.length - 3}</span>` : '') : '<span class="dim">—</span>'}</div></td>
            <td><span class="status${on ? '' : ' status-muted'}"><span class="dot ${on ? 'dot-success' : ''}"></span>${on ? '启用' : '已停用'}</span></td>
            <td class="col-num${links ? '' : ' dim'}">${links ? `<a class="num-link" href="links.html?mailbox=${addr}" title="查看 ${links} 个取件链接" aria-label="${addr} 有 ${links} 个取件链接，查看">${links}</a>` : '0'}</td>
            <td class="col-num${users ? '' : ' dim'}">${users ? `<a class="num-link" href="users.html?mailbox=${addr}" title="查看 ${users} 位授权用户" aria-label="${addr} 授权给 ${users} 位用户，查看">${users}</a>` : '0'}</td>
            <td class="time${last ? '' : ' dim'}">${last || '从未来信'}</td>
            <td class="col-actions"><div class="row-actions" role="group" aria-label="${addr} 的操作">
              <a class="btn btn-ghost btn-sm btn-icon" href="mails.html?address=${addr}" title="该地址的邮件" aria-label="查看 ${addr} 的邮件">${icon('inbox')}</a>
              <a class="btn btn-ghost btn-sm btn-icon" href="links.html?mailbox=${addr}" title="已有链接" aria-label="查看 ${addr} 已有的链接">${icon('link')}</a>
              <a class="btn btn-ghost btn-sm btn-icon" href="users.html?mailbox=${addr}" title="已有授权" aria-label="查看 ${addr} 已有的授权">${icon('user-check')}</a>
              <button class="btn btn-ghost btn-sm btn-icon" type="button" aria-haspopup="menu" title="更多" aria-label="${addr} 的更多操作">${icon('more')}</button>
            </div></td>
          </tr>`).join('');

const src = join(here, 'src');
for (const f of readdirSync(src).filter((n) => n.endsWith('.html'))) {
  let html = readFileSync(join(src, f), 'utf8');
  html = html
    .replace('<!--@sprite-->', sprite)
    .replace(/<!--@devbar-float(:sim)?-->/, (_, sim) => devbarFloat(Boolean(sim)))
    .replace('<!--@mailbox-rows-->', rows)
    .replace(/<!--@sidebar:(\w+)-->/, (_, cur) => sidebar(cur))
    .replace(/<!--@icon:([\w-]+)(?::([\w-]+))?-->/g, (_, n, c) => icon(n, c || ''));
  writeFileSync(join(here, f), html);
  console.log('built design/prototypes/' + f);
}
