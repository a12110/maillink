// 取件页组件测试的公共件：状态构造、假 API、挂载与生命周期（测试文件里调用 installLifecycle()）
import { act, createElement } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import type { LinkDeliveryQuota, LinkPublicStatus, PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { PickupPage } from "./PickupPage";
import type { PickupApi } from "./pickup-api";

import type { TurnstileLoader } from "../turnstile/loader";

export const loadTurnstile = vi.fn<TurnstileLoader>();

export const TOKEN = "TOKEN_SECRET_VALUE_0123456789abcdefghijklmnopqrstuv";
export const NOW = new Date(2026, 10, 20, 12, 0, 0);
export const nowSec = () => Math.floor(NOW.getTime() / 1000);

let mounted: Mounted | null = null;

export function installLifecycle(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(async () => {
    await unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
    document.title = "";
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });
}

export async function unmount(): Promise<void> {
  await mounted?.unmount();
  mounted = null;
}

export function status(overrides: Partial<LinkPublicStatus> = {}): LinkPublicStatus {
  return {
    state: "active",
    activated: true,
    visitor_registered: true,
    requires_password: false,
    requires_turnstile: false,
    turnstile: { required: false },
    site: { show_brand: false },
    view: "code_only",
    reveal: "auto",
    deliveries: null,
    poll_interval_sec: 10,
    mailboxes: ["sw***@icloud.com"],
    mailbox_count: 1,
    recipient_display: "masked",
    expires_at: nowSec() + 2 * 86_400,
    expire_after_first_access_sec: null,
    public_title: "ChatGPT 共享号",
    public_note: null,
    retry_after_at: null,
    max_devices: null,
    ...overrides,
  };
}

export function quota(overrides: Partial<LinkDeliveryQuota> = {}): LinkDeliveryQuota {
  return { total_limit: 2, total_used: 0, total_remaining: 2, daily_limit: null, daily_used: 0, daily_remaining: null, daily_resets_at: null, ...overrides };
}

export function mail(id: number, ageSec: number, extra: Partial<PresentedMail> = {}): PresentedMail {
  return { id, received_at: nowSec() - ageSec, sender: { name: "OpenAI" }, ...extra };
}

export function list(items: PresentedMail[]): VisibleMailListResponse {
  return { items, next_cursor: null, partial: false, next_after_id: items[0]?.id ?? null };
}

export type MockedApi = { [K in keyof PickupApi]: ReturnType<typeof vi.fn<PickupApi[K]>> };

export function fakeApi(over: Partial<PickupApi> = {}): MockedApi {
  const base: MockedApi = {
    status: vi.fn<PickupApi["status"]>(async () => status()),
    start: vi.fn<PickupApi["start"]>(async () => status()),
    mails: vi.fn<PickupApi["mails"]>(async () => list([])),
    reveal: vi.fn<PickupApi["reveal"]>(),
    detail: vi.fn<PickupApi["detail"]>(),
  };
  return Object.assign(base, over) as MockedApi;
}

export async function open(api: PickupApi): Promise<HTMLElement> {
  mounted = await mount(createElement(PickupPage, { token: TOKEN, api, turnstileLoader: loadTurnstile }));
  await settle();
  return mounted.container;
}

export async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

export function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}\n${root.textContent}`);
  return found;
}
