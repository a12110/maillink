// 组件测试的最小渲染工具（不引入 testing-library）：需要在测试文件里加 `// @vitest-environment happy-dom`。
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export type Mounted = {
  container: HTMLElement;
  render: (element: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
};

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const render = async (next: ReactElement) => {
    await act(async () => root.render(next));
  };
  await render(element);
  return {
    container,
    render,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** 触发 React 受控输入的 change：直接改 value 不会通知 React，要走原生 setter 再派发 input 事件 */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("找不到 HTMLInputElement.value 的 setter");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

export { createElement };
