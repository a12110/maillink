import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorLine } from "../../lib/messages";
import { Button } from "../../ui";

/** 完整链接：只读输入框 + 复制按钮。复制失败就地说明原因（不假装成功），可手动选中复制 */
export function LinkUrlBox({ url, autoCopy, label = "完整取件链接" }: { url: string; autoCopy?: boolean; label?: string }) {
  const [state, setState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState({ tone: "ok", text: "已复制到剪贴板" });
    } catch (cause) {
      setState({ tone: "error", text: `复制失败：${errorLine(cause)}。请手动选中上面的内容复制。` });
    }
  };
  const copyRef = useRef(copy);
  copyRef.current = copy;
  useEffect(() => {
    if (autoCopy) void copyRef.current();
  }, [autoCopy]);
  return (
    <div className="url-box">
      <div className="url-row">
        <input className="input" data-mono="true" readOnly value={url} aria-label={label} onFocus={(event) => event.currentTarget.select()} />
        <Button onClick={() => void copy()}>
          <Copy />
          复制
        </Button>
      </div>
      {state ? (
        <p className={state.tone === "ok" ? "field-hint" : "field-error"} role="status">
          {state.text}
        </p>
      ) : null}
    </div>
  );
}
