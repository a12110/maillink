import { useMemo } from "react";
import { encode } from "uqr";

/**
 * 在浏览器里本地生成二维码（uqr 纯计算，不请求任何外部服务；otpauth 地址含密钥，绝不能发给第三方）。
 * 渲染成单个 SVG <path>，不用 dangerouslySetInnerHTML。留白与黑白底由 CSS `.qr` 负责。
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { data, size: modules } = encode(value, { ecc: "M", border: 0 });
    const cells: string[] = [];
    data.forEach((row, y) => row.forEach((dark, x) => dark && cells.push(`M${x} ${y}h1v1h-1z`)));
    return { size: modules, path: cells.join("") };
  }, [value]);
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <path d={path} />
    </svg>
  );
}
