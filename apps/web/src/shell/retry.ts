import type { AnyRouter } from "@tanstack/react-router";

/**
 * 路由出错页的“重试”：只调 reset() 不会重跑 beforeLoad（根守卫里的请求），
 * 所以先 invalidate 让整条路由链重新加载，再 reset 清掉错误边界。
 */
export async function retryRoute(router: Pick<AnyRouter, "invalidate">, reset: () => void): Promise<void> {
  await router.invalidate();
  reset();
}
