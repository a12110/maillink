// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_LOGO_MAX_LENGTH } from "@maillink/shared";
import { settle } from "../../test/dom";
import { mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { checkLogoDataUri, checkLogoFile, LOGO_MAX_FILE_BYTES, LogoField } from "./LogoField";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

async function chooseFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("没有文件输入框");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

const image = (bytes: number, type = "image/png") => new File([new Uint8Array(bytes)], "logo.png", { type });

describe("Logo 字节上限由 shared 的字符数上限换算", () => {
  it("LOGO_MAX_FILE_BYTES = 字符数上限 × 3/4（base64）", () => {
    expect(LOGO_MAX_FILE_BYTES).toBe(Math.floor(SITE_LOGO_MAX_LENGTH * 0.75));
    expect(checkLogoFile({ type: "image/png", size: LOGO_MAX_FILE_BYTES })).toBeNull();
    expect(checkLogoFile({ type: "image/png", size: LOGO_MAX_FILE_BYTES + 1 })).toContain("图片太大");
    expect(checkLogoFile({ type: "text/plain", size: 1 })).toContain("只能上传图片文件");
    expect(checkLogoDataUri("x".repeat(SITE_LOGO_MAX_LENGTH + 1))).toContain("图片太大");
    expect(checkLogoDataUri("x".repeat(SITE_LOGO_MAX_LENGTH))).toBeNull();
  });
});

describe("Logo 上传", () => {
  it("文件超过上限：就地报错，不读文件、不回写", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const onChange = vi.fn();
    mounted = await mount(createElement(LogoField, { value: "", onChange }));
    await chooseFile(mounted.container, image(LOGO_MAX_FILE_BYTES + 1));
    expect(read).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(mounted.container.querySelector(".field-error")?.textContent).toContain("图片太大");
  });

  it("不是图片：同样在读取之前就报错", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    mounted = await mount(createElement(LogoField, { value: "", onChange: vi.fn() }));
    await chooseFile(mounted.container, image(10, "application/pdf"));
    expect(read).not.toHaveBeenCalled();
    expect(mounted.container.querySelector(".field-error")?.textContent).toContain("只能上传图片文件");
  });

  it("大小合规的图片：读成 data URI 并回写，之前的报错清掉", async () => {
    const onChange = vi.fn();
    mounted = await mount(createElement(LogoField, { value: "", onChange }));
    await chooseFile(mounted.container, image(LOGO_MAX_FILE_BYTES + 1));
    expect(mounted.container.querySelector(".field-error")).not.toBeNull();
    await chooseFile(mounted.container, image(16));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(String(onChange.mock.calls[0]?.[0])).toMatch(/^data:image\/png;base64,/);
    expect(mounted.container.querySelector(".field-error")).toBeNull();
  });
});
