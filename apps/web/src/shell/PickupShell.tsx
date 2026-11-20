import { Mail } from "lucide-react";
import type { ReactNode } from "react";

export type PickupBrand = {
  name?: string;
  /** 只接受 data:image/（取件页不加载第三方资源）；其他值一律忽略 */
  logo?: string;
};

type PickupShellProps = {
  children: ReactNode;
  /** 站点品牌（`site.show_brand` 为 true 时由页面传入）；不传则不显示品牌 */
  brand?: PickupBrand;
  /** 右上角信息，如“剩余有效 2 天 3 小时” */
  topRight?: ReactNode;
  /** 列表 + 详情视图：≥1024 并排，放宽到 1120px */
  wide?: boolean;
};

const DATA_IMAGE_PREFIX = "data:image/";

/**
 * 取件页外壳：无导航、手机优先单栏（--pickup-max-width）。不加载任何第三方资源。
 * 品牌（名称、data URI Logo、公告）来自 `GET /api/s/:token` 的 `site`，本组件不查询配置；
 * 但外观（强调色、圆角、明暗）只有 /api/public/config.appearance 提供，由 app/bootstrap 在所有页面启动时取一次并应用，
 * 取件页按卖家设置的外观显示（设置页的外观预览就是取件卡片），所以 /s/ 下保留这次请求，不跳过。
 * 子节点由页面用 PickupMain / PickupBar 组合。根节点同时带 `pk-page`，设计脚本 design/scripts/hit-area.js 按这个类名选可点元素。
 */
export function PickupShell({ children, brand, topRight, wide }: PickupShellProps) {
  const logo = brand?.logo?.startsWith(DATA_IMAGE_PREFIX) ? brand.logo : undefined;
  return (
    <div className="pickup-shell pk-page" data-wide={wide ? "true" : undefined}>
      <header className="pickup-top">
        {brand ? (
          <span className="pk-brand">
            {logo ? (
              <img className="pk-logo" src={logo} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="brand-mark" aria-hidden="true">
                <Mail />
              </span>
            )}
            {brand.name ? <span>{brand.name}</span> : null}
          </span>
        ) : (
          <span />
        )}
        {topRight}
      </header>
      {children}
    </div>
  );
}

/** 取件页内容区：状态页、取码页、列表页都用它包住主体 */
export function PickupMain({ children }: { children: ReactNode }) {
  return <main className="pickup-main">{children}</main>;
}

/** 底部通栏主操作（sticky，高 44，计入 safe-area）。每个视图自己决定放什么 */
export function PickupBar({ children, row }: { children: ReactNode; row?: boolean }) {
  return (
    <div className="pk-bar">
      <div className={row ? "pk-bar-row" : undefined}>{children}</div>
    </div>
  );
}
