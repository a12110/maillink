import { act } from "react";

/** 元素的可见文字：带“提交中”文案的按钮（.btn-swap）里只算第一个（常态）文案 */
function visibleText(el: HTMLElement): string {
  const swap = el.querySelector(".btn-swap");
  return (swap?.firstElementChild ?? el).textContent?.trim() ?? "";
}

/** 按可见文字找元素；找不到直接抛错（测试里不允许“没找到就当没事”） */
export function byText<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string, text: string | RegExp): T {
  const found = Array.from(root.querySelectorAll<T>(selector)).find((el) =>
    typeof text === "string" ? visibleText(el) === text : text.test(visibleText(el)),
  );
  if (!found) throw new Error(`找不到 <${selector}> 文字 ${String(text)}；当前内容：${root.textContent?.slice(0, 300)}`);
  return found;
}

/** 按字段标签（TextField 的 label.field-label，不含分段控件里的 label）找输入框 */
export function inputByLabel(root: ParentNode, label: string | RegExp): HTMLInputElement {
  const labelEl = byText<HTMLLabelElement>(root, "label.field-label", label);
  const input = labelEl.htmlFor ? root.querySelector<HTMLInputElement>(`[id="${CSS.escape(labelEl.htmlFor)}"]`) : labelEl.querySelector("input");
  if (!input) throw new Error(`标签 ${String(label)} 没有对应的输入框`);
  return input;
}

/** 等异步状态（请求、定时器）落定：让出若干轮事件循环，每轮都包在 act 里 */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** 提交表单（React 的 onSubmit 需要真实的 submit 事件） */
export async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
