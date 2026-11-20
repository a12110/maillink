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

/** 触发 React 受控输入的 change：直接改 value 不会通知 React，要走原生 setter 再派发 input 事件（输入框与文本域各有自己的 setter） */
export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("找不到 value 的 setter");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 改 <select> 的值并触发 change */
export async function selectValue(select: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (!setter) throw new Error("找不到 HTMLSelectElement.value 的 setter");
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** 在元素上按一个键（keydown） */
export async function pressKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** 等异步更新落定（请求 mock 的 resolve / reject 之后的状态变化）：让出一个宏任务，包在 act 里 */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export { createElement };
