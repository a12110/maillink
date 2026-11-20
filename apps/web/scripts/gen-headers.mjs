// 构建后生成 dist/_headers（Workers Static Assets 的自定义响应头），给 SPA 页面加安全头。
// 页面不经过 Worker（wrangler.jsonc 的 run_worker_first 只有 /api/*），所以页面级 CSP 只能放在这里。
// 内联 <script> 不手写哈希：读取构建产物 dist/index.html，逐段计算 sha256 写进 script-src。
// 用法：node scripts/gen-headers.mjs [distDir]（默认 apps/web/dist），由 package.json 的 build 在 vite build 之后调用。
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** _headers 单行上限（Cloudflare 文档：每行 2000 字符），超出时构建失败而不是生成被截断的策略 */
const MAX_LINE_LENGTH = 2000;

const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
const SRC_ATTRIBUTE = /\ssrc\s*=/iu;
/** <script 开标签，按引号感知地取到真正的结尾 >：属性值里可以有 > */
const SCRIPT_OPEN_TAG = /<script\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
/** 去掉脚本正文后，HTML 里任何标签上的 on*= 事件属性 */
const EVENT_ATTRIBUTE = /<[a-z][^>]*?\son[a-z]+\s*=/iu;
const JAVASCRIPT_URL = /javascript\s*:/iu;

/**
 * 构建失败而不是生成会被 CSP 拦掉或算错哈希的策略：
 * - on*= 事件属性：哈希只覆盖 <script> 正文，事件属性会被 CSP 拦下（页面功能悄悄失效）；
 * - javascript: 链接：同样会被拦，而且本不该出现；
 * - <script> 开标签的属性值里含 >：下面按 [^>]* 切分正文会切错，哈希对不上。
 */
export function assertCspCompatible(html) {
  for (const tag of html.match(SCRIPT_OPEN_TAG) ?? []) {
    if (tag.slice(0, -1).includes(">")) throw new Error(`<script> 的属性里含有 ">"，无法可靠计算内联脚本哈希：${tag.slice(0, 80)}`);
  }
  const markup = html.replace(SCRIPT_PATTERN, "<script></script>");
  const event = EVENT_ATTRIBUTE.exec(markup);
  if (event !== null) throw new Error(`index.html 含内联事件属性（on*=），会被 CSP 拦截：${event[0].slice(0, 80)}`);
  const js = JAVASCRIPT_URL.exec(markup);
  if (js !== null) throw new Error("index.html 含 javascript: 链接，会被 CSP 拦截");
}

/** index.html 里每段内联脚本（没有 src 属性的 <script>）的 CSP 哈希源，按出现顺序去重 */
export function inlineScriptHashes(html) {
  assertCspCompatible(html);
  const hashes = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    const [, attributes, body] = match;
    if (SRC_ATTRIBUTE.test(` ${attributes}`)) continue;
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    const source = `'sha256-${digest}'`;
    if (!hashes.includes(source)) hashes.push(source);
  }
  return hashes;
}

/**
 * 页面 CSP。要点：
 * - script-src：自身 + 内联脚本哈希 + Turnstile（取件页与登录、注册页按需加载控件脚本）；
 * - frame-src：Turnstile 的挑战 iframe；邮件正文的 srcdoc iframe 不受 frame-src 约束，但会继承本策略；
 * - style-src 'unsafe-inline'：React 的 style 属性与邮件 srcdoc 里的内联样式都需要；
 * - img-src data: https:：邮件规则组 remote_images=allow 时 srcdoc 继承父页面 CSP，需要放行 https 图片；
 * - 其余收紧到自身或 none，禁止被嵌入。
 */
export function contentSecurityPolicy(hashes) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashes, TURNSTILE_ORIGIN].join(" "),
    `frame-src ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 关掉用不到的能力；通行密钥（publickey-credentials-*）与剪贴板写入保持浏览器默认（仅本站） */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "bluetooth=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/** 生成 _headers 文本：/* 全站安全头；/s/* 取件页另加 no-store 与 noindex（02 §6） */
export function buildHeadersFile(html) {
  const rules = [
    [
      "/*",
      [
        ["Content-Security-Policy", contentSecurityPolicy(inlineScriptHashes(html))],
        ["Referrer-Policy", "no-referrer"],
        ["X-Content-Type-Options", "nosniff"],
        ["X-Frame-Options", "DENY"],
        ["Permissions-Policy", PERMISSIONS_POLICY],
      ],
    ],
    [
      "/s/*",
      [
        ["Cache-Control", "no-store"],
        ["X-Robots-Tag", "noindex, nofollow"],
      ],
    ],
  ];
  const lines = rules.flatMap(([path, headers]) => [path, ...headers.map(([name, value]) => `  ${name}: ${value}`)]);
  const tooLong = lines.find((line) => line.length > MAX_LINE_LENGTH);
  if (tooLong !== undefined) throw new Error(`_headers 行超过 ${MAX_LINE_LENGTH} 字符：${tooLong.slice(0, 80)}…`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = resolve(process.argv[2] ?? join(here, "..", "dist"));
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) throw new Error(`找不到 ${indexPath}：先运行 vite build`);
  const html = readFileSync(indexPath, "utf8");
  writeFileSync(join(distDir, "_headers"), buildHeadersFile(html));
  process.stdout.write(`已生成 ${join(distDir, "_headers")}（内联脚本哈希 ${inlineScriptHashes(html).length} 个）\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
