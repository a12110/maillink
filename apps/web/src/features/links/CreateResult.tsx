import type { ShareLinkCreateResponse } from "@maillink/shared";
import { Callout } from "../../ui";
import { ExportPanel } from "./ExportPanel";
import { LinkUrlBox } from "./LinkUrlBox";
import { linkTitle } from "./labels";

/** 结果页：完整链接只在这里显示一次（关闭后要用“复制链接”，会写审计）；可复制、导出 CSV 或按行模板 */
export function CreateResult({ result }: { result: ShareLinkCreateResponse }) {
  const ids = result.items.map((item) => item.link.id);
  return (
    <div className="step-body">
      <Callout tone="warning" title={`已生成 ${result.items.length} 个链接，完整链接只在这里显示一次`}>
        关闭这个窗口后不再显示；之后需要时在表格里点“复制链接”（会写审计）。口令不会显示，请自己记下。
      </Callout>
      {result.warnings.length > 0 ? (
        <Callout tone="info" title="这些地址已经有生效的链接">
          共享号有多个链接是正常情况，仅提示：{result.warnings.map((warning) => `${warning.address}（${warning.active_link_count} 个）`).join("、")}
        </Callout>
      ) : null}
      <ul className="result-links">
        {result.items.map((item) => (
          <li key={item.link.id}>
            <div className="result-title">
              <b>{linkTitle(item.link)}</b>
              <span className="mono dim">{item.link.mailboxes.map((mailbox) => mailbox.address).join("、")}</span>
            </div>
            <LinkUrlBox url={item.url} />
          </li>
        ))}
      </ul>
      <ExportPanel ids={ids} primary={false} />
    </div>
  );
}
