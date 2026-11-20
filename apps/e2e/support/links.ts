import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ORIGIN } from "./env";

/** 创建向导里要填的内容；没写的字段保持向导默认值（不设口令、不限设备与次数） */
export type LinkSpec = {
  /** 名称（管理员可见），也是链接列表里的标题 */
  name: string;
  address: string;
  ruleGroup: string;
  publicTitle?: string;
  publicNote?: string;
  password?: string;
  maxDevices?: number;
  maxTotal?: number;
  maxPerDay?: number;
  pollIntervalSec?: number;
};

export type CreatedLink = { url: string; path: string; token: string };

const TOKEN_PATH = /^\/s\/([^/?#]+)$/;

/** 在 `/admin/links` 用创建向导建一个链接，返回结果页上显示的完整链接 */
export async function createLinkViaWizard(page: Page, spec: LinkSpec): Promise<CreatedLink> {
  await page.goto("/admin/links");
  await page.getByRole("button", { name: "生成取件链接" }).first().click();
  const dialog = page.getByRole("dialog", { name: "生成取件链接" });
  await pickAddress(dialog, spec.address);
  await dialog.getByRole("button", { name: "下一步" }).click();
  await dialog.getByRole("radio", { name: new RegExp(spec.ruleGroup) }).check();
  await dialog.getByRole("button", { name: "下一步" }).click();
  await fillAccessStep(dialog, spec);
  await dialog.getByRole("button", { name: "生成取件链接" }).click();
  return readResult(page);
}

async function pickAddress(dialog: Locator, address: string): Promise<void> {
  await dialog.getByRole("checkbox", { name: new RegExp(address.replaceAll(".", "\\.")) }).check();
}

async function fillAccessStep(dialog: Locator, spec: LinkSpec): Promise<void> {
  await dialog.getByLabel("名称（仅管理员可见）").fill(spec.name);
  if (spec.publicTitle) await dialog.getByLabel("买家看到的标题").fill(spec.publicTitle);
  if (spec.publicNote) await dialog.getByLabel("买家看到的说明").fill(spec.publicNote);
  if (spec.password) await dialog.getByLabel("访问口令").fill(spec.password);
  if (spec.maxDevices) await dialog.getByLabel("设备数上限").fill(String(spec.maxDevices));
  if (spec.maxTotal) await dialog.getByLabel("总取码次数").fill(String(spec.maxTotal));
  if (spec.maxPerDay) await dialog.getByLabel("每 24 小时次数").fill(String(spec.maxPerDay));
  if (spec.maxTotal || spec.maxPerDay) {
    // 设了取码次数：取码方式自动切为点击取码，并锁住不让改回
    const click = dialog.getByRole("radio", { name: "点击取码" });
    await expect(click).toBeChecked();
    await expect(click).toBeDisabled();
    await expect(dialog.getByText("取码方式已自动切换为“点击取码”")).toBeVisible();
  }
  if (spec.pollIntervalSec) await dialog.getByLabel("轮询间隔（秒）").fill(String(spec.pollIntervalSec));
}

async function readResult(page: Page): Promise<CreatedLink> {
  await expect(page.getByRole("dialog", { name: "取件链接已生成" })).toBeVisible();
  const url = await page.getByLabel("完整取件链接").inputValue();
  expect(url.startsWith(`${ORIGIN}/s/`), `链接应是本站的 /s/<token>：${url}`).toBe(true);
  const path = new URL(url).pathname;
  const token = TOKEN_PATH.exec(path)?.[1];
  expect(token, `链接路径：${path}`).toBeTruthy();
  await page.getByRole("dialog").getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  return { url, path, token: token as string };
}

/** 记录页面对某类地址的请求（按路径片段匹配），用来断言"之后不再请求"或"继续轮询" */
export function trackRequests(page: Page, fragment: string): { count: () => number; urls: () => string[] } {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(fragment)) urls.push(request.url());
  });
  return { count: () => urls.length, urls: () => [...urls] };
}

/**
 * 等页面把已经发出的请求都走完：做一次同源的真实往返。
 * `page.clock` 只推进页面里的定时器，网络仍是真的；推进之后先过一遍这个，再数请求，才不会漏掉刚发出的那一个。
 */
export async function settleNetwork(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await fetch("/api/public/config", { cache: "no-store" });
  });
}
