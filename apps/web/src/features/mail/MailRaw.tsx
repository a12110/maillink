import { Copy } from "lucide-react";
import { useMemo } from "react";
import { RAW_PREVIEW_MAX_CHARS } from "../../constants";
import { Button, Callout } from "../../ui";
import { formatBytes } from "./labels";
import { useCopy } from "./useCopy";

/** 原文：等宽、可选中、超长折行；渲染有字符数上限，“复制原文”始终复制完整内容 */
export function MailRaw({ raw }: { raw: string }) {
  const { copy, error: copyError } = useCopy();
  const truncated = raw.length > RAW_PREVIEW_MAX_CHARS;
  const size = useMemo(() => new Blob([raw]).size, [raw]);

  return (
    <div className="mail-raw-block">
      <div className="mail-raw-bar">
        <span className="num">{formatBytes(size)}</span>
        <Button size="sm" onClick={() => void copy(raw, "已复制原文")}>
          <Copy />
          复制原文
        </Button>
      </div>
      {copyError ? (
        <Callout tone="danger" title="复制失败">
          {copyError}。请选中下面的文本手动复制。
        </Callout>
      ) : null}
      {truncated ? (
        <Callout tone="warning" title="原文较长，只显示开头一部分">
          共 {raw.length.toLocaleString()} 个字符，这里显示前 {RAW_PREVIEW_MAX_CHARS.toLocaleString()} 个；“复制原文”会复制全部。
        </Callout>
      ) : null}
      <pre className="mail-raw" tabIndex={0} aria-label="邮件原文">
        {truncated ? raw.slice(0, RAW_PREVIEW_MAX_CHARS) : raw}
      </pre>
    </div>
  );
}
