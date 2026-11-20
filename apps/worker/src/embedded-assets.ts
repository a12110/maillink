// 单文件部署（docs/deploy-gui.md）：在控制台上传的 worker.js 没有 Workers Static Assets，前端 dist 在构建时打进 bundle，
// 由这里模拟 wrangler.jsonc 里 assets 的行为：/api/* 交给原 Worker（run_worker_first），其余路径按文件直出，
// 找不到时回退 index.html（not_found_handling: single-page-application），并套用构建生成的 _headers 规则。
// 入口由 scripts/build-single-worker.ts 生成；正常的 wrangler deploy 不经过这里。

import {
  EMBEDDED_ASSET_CACHE_CONTROL,
  EMBEDDED_HASHED_ASSET_CACHE_CONTROL,
  EMBEDDED_HASHED_ASSET_PREFIX,
  WORKER_FIRST_PATH_PREFIX,
} from "./constants";
import type { EmbeddedAsset, EmbeddedAssetManifest, EmbeddedHeaderRule } from "./embedded-assets-manifest";
import { HTTP_METHOD_NOT_ALLOWED, HTTP_OK } from "./http-status";

/** 被包装的 Worker：env 原样转交，这里不读取也不改动其中的绑定 */
export type WorkerHandlers<E> = {
  fetch(request: Request, env: E, ctx: ExecutionContext): Response | Promise<Response>;
  scheduled(controller: ScheduledController, env: E, ctx: ExecutionContext): Promise<void>;
};

type PreparedAsset = { contentType: string; body: string | Uint8Array };

const ALLOWED_METHODS = "GET, HEAD";

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function prepare(asset: EmbeddedAsset): PreparedAsset {
  const body = asset.encoding === "utf8" ? asset.body : decodeBase64(asset.body);
  return { contentType: asset.contentType, body };
}

function matchesPattern(pattern: string, pathname: string): boolean {
  return pattern.endsWith("/*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
}

/** 多条规则设置同一个头时按 _headers 的语义用逗号合并，再覆盖默认的 Cache-Control 等 */
function applyHeaderRules(headers: Headers, rules: EmbeddedHeaderRule[], pathname: string): void {
  const ruled = new Headers();
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) ruled.append(name, value);
  }
  ruled.forEach((value, name) => headers.set(name, value));
}

/** 只有真实命中的哈希文件才长期缓存；回退出来的 index.html 不能被当成 /assets/xxx 缓存一年 */
function cacheControlFor(filePath: string, hit: boolean): string {
  return hit && filePath.startsWith(EMBEDDED_HASHED_ASSET_PREFIX)
    ? EMBEDDED_HASHED_ASSET_CACHE_CONTROL
    : EMBEDDED_ASSET_CACHE_CONTROL;
}

function bodyFor(method: string, asset: PreparedAsset): string | Uint8Array | null {
  if (method === "HEAD") return null;
  // 同一份 Uint8Array 会被多次响应复用，交出副本
  return typeof asset.body === "string" ? asset.body : asset.body.slice();
}

/** 生成只处理非 /api/* 路径的静态资源响应函数；清单缺回退页时直接抛错，不带病启动 */
export function createAssetResponder(manifest: EmbeddedAssetManifest): (request: Request) => Response {
  const files = new Map<string, PreparedAsset>();
  for (const [path, asset] of Object.entries(manifest.files)) files.set(path, prepare(asset));
  const fallback = files.get(manifest.spaFallback);
  if (fallback === undefined) throw new Error(`内嵌静态资源缺少回退页 ${manifest.spaFallback}`);

  return (request) => {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const headers = new Headers({ Allow: ALLOWED_METHODS });
      applyHeaderRules(headers, manifest.headerRules, pathname);
      return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED, headers });
    }
    const filePath = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const hit = files.get(filePath);
    const asset = hit ?? fallback;
    const headers = new Headers({
      "Content-Type": asset.contentType,
      "Cache-Control": cacheControlFor(filePath, hit !== undefined),
    });
    applyHeaderRules(headers, manifest.headerRules, pathname);
    return new Response(bodyFor(request.method, asset), { status: HTTP_OK, headers });
  };
}

/** 把原 Worker 包成"/api/* 走原逻辑、其余路径走内嵌前端"的单文件 Worker；cron 原样转交 */
export function withEmbeddedAssets<E>(worker: WorkerHandlers<E>, manifest: EmbeddedAssetManifest): WorkerHandlers<E> {
  const serveAsset = createAssetResponder(manifest);
  return {
    fetch(request, env, ctx) {
      if (new URL(request.url).pathname.startsWith(WORKER_FIRST_PATH_PREFIX)) return worker.fetch(request, env, ctx);
      return serveAsset(request);
    },
    scheduled: (controller, env, ctx) => worker.scheduled(controller, env, ctx),
  };
}
