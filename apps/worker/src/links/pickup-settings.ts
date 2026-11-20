import type { LinkAccessStored, LinkPublicStatus } from "@maillink/shared";
import { getSettings } from "../db/settings";

// 取件页需要的系统设置（站点品牌、公告、Turnstile site key）。取件页不加载第三方资源：
// Logo 只给 data:image/ 形式；Turnstile 只看链接自己的开关（PLAN 默认决策）。

const DATA_IMAGE_PREFIX = "data:image/";

export type PickupSettings = Pick<LinkPublicStatus, "turnstile" | "site">;

export async function loadPickupSettings(db: D1Database, access: LinkAccessStored): Promise<PickupSettings> {
  const stored = await getSettings(db, ["site.name", "site.logo", "site.pickup_notice", "links.show_brand", "turnstile.site_key"]);
  const siteKey = stored["turnstile.site_key"];
  const logo = stored["site.logo"];
  const notice = stored["site.pickup_notice"];
  const showBrand = stored["links.show_brand"];
  return {
    turnstile: access.turnstile && siteKey !== "" ? { required: true, site_key: siteKey } : { required: access.turnstile },
    site: {
      show_brand: showBrand,
      ...(showBrand ? { name: stored["site.name"] } : {}),
      ...(showBrand && logo.startsWith(DATA_IMAGE_PREFIX) ? { logo } : {}),
      ...(notice === "" ? {} : { notice }),
    },
  };
}
