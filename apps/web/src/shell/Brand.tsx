import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useState } from "react";
import { publicConfigQuery } from "../api/queries";
import { logoSource } from "./brand-logo";

function DefaultMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Mail />
    </span>
  );
}

/** 外链 Logo 可能 404 或被拦截：加载失败后回退默认图标，不留破图。src 变化时由 key 重置失败状态 */
function LogoImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <DefaultMark />;
  return (
    <img
      className="brand-logo"
      src={src}
      alt={name ? `${name} Logo` : "站点 Logo"}
      width={24}
      height={24}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** 站点 Logo（设置 → 站点信息）；没有、不被接受或加载失败时用墨色方块 + 信封图标。配置加载中占位同尺寸，避免跳动 */
export function BrandMark() {
  const { data, isPending } = useQuery(publicConfigQuery());
  if (isPending) return <span className="skeleton brand-logo" aria-hidden="true" />;
  const src = logoSource(data?.site_logo, "app");
  return src ? <LogoImage key={src} src={src} name={data?.site_name ?? ""} /> : <DefaultMark />;
}

export function SiteName() {
  const { data, isPending } = useQuery(publicConfigQuery());
  if (isPending) return <span className="skeleton brand-skeleton" aria-hidden="true" />;
  // 配置加载失败时不编造名称；错误会在页面主体里以真实请求暴露
  return <span className="brand-name">{data?.site_name}</span>;
}

/** 站点描述（认证页）；纯文本，为空不渲染 */
export function SiteDescription({ className }: { className?: string }) {
  const { data } = useQuery(publicConfigQuery());
  return data?.site_description ? <p className={className}>{data.site_description}</p> : null;
}

/** 页脚文字；纯文本，为空不渲染 */
export function SiteFooter({ className }: { className?: string }) {
  const { data } = useQuery(publicConfigQuery());
  return data?.site_footer ? <p className={className}>{data.site_footer}</p> : null;
}
