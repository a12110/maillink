import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { publicConfigQuery } from "../api/queries";

/** 墨色方块 + 信封图标占位（暂无自有 Logo）；站点名称来自 /api/public/config，不写死 */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Mail />
    </span>
  );
}

export function SiteName() {
  const { data, isPending } = useQuery(publicConfigQuery());
  if (isPending) return <span className="skeleton brand-skeleton" aria-hidden="true" />;
  // 配置加载失败时不编造名称；错误会在页面主体里以真实请求暴露
  return <span className="brand-name">{data?.site_name}</span>;
}
