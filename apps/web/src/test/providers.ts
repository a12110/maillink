import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactElement } from "react";
import { ToastProvider } from "../ui";
import { mount } from "./render";
import type { Mounted } from "./render";

/** 不重试、不缓存失败的测试用 QueryClient：错误立刻暴露，而不是被重试吞掉 */
export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

/** 挂载带 QueryClient 与 Toast 的组件（不含路由） */
export async function mountWithProviders(element: ReactElement, client: QueryClient = testQueryClient()): Promise<Mounted> {
  return mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, element)));
}
