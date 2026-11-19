import { createApiClient } from "./client";
import { createEndpoints } from "./endpoints";

let unauthorizedHandler: () => void = () => {
  throw new Error("尚未注册 401 处理器（应在 app/bootstrap 中调用 setUnauthorizedHandler）");
};

/** 由应用启动时注册：清会话缓存并跳 /login。放在这里避免 api ↔ router 循环依赖 */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

export const api = createEndpoints(
  createApiClient({
    fetchImpl: (input, init) => fetch(input, init),
    onUnauthorized: () => unauthorizedHandler(),
  }),
);
