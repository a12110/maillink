import type { ReactNode } from "react";
import { BrandMark, SiteName } from "./Brand";

/**
 * 取件页外壳：无导航、手机优先单栏（--pickup-max-width）。不加载任何第三方资源。
 * 本里程碑只有外壳，页面本身在 M3b 之后做；“剩余有效时间”等右上角信息由页面传入。
 */
export function PickupShell({ children, topRight }: { children: ReactNode; topRight?: ReactNode }) {
  return (
    <div className="pickup-shell">
      <header className="pickup-top">
        <span className="brand">
          <BrandMark />
          <SiteName />
        </span>
        {topRight}
      </header>
      <main className="pickup-main">{children}</main>
    </div>
  );
}
