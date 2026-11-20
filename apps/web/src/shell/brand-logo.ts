/** 站点 Logo 的可渲染来源：认证页与工作区接受 data:image/ 与 https://；取件页只接受 data:image/（不加载第三方资源，PLAN 默认决策） */
export type LogoSurface = "app" | "pickup";

const DATA_IMAGE_PREFIX = "data:image/";

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** 返回可直接放进 <img src> 的值；空值或不被该场景接受的协议返回 undefined */
export function logoSource(value: string | undefined, surface: LogoSurface): string | undefined {
  if (!value) return undefined;
  if (value.toLowerCase().startsWith(DATA_IMAGE_PREFIX)) return value;
  if (surface === "app" && isHttpsUrl(value)) return value;
  return undefined;
}
