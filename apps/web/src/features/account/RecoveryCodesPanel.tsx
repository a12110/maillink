import { Copy, Download } from "lucide-react";
import { Button, Callout } from "../../ui";
import { useCopy } from "../mail/useCopy";
import { buildRecoveryCodesFile, RECOVERY_CODES_FILENAME } from "./totp-flow";

type Props = {
  codes: readonly string[];
  /** enable：刚启用 2FA；regenerate：重新生成（旧码已作废） */
  origin: "enable" | "regenerate";
  siteName: string;
  username: string;
  onDone: () => void;
};

/** 在浏览器里把文本存成本地文件：Blob + object URL，不经过网络 */
function saveTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 恢复码只显示这一次：关闭面板后后端也无法再取回 */
export function RecoveryCodesPanel({ codes, origin, siteName, username, onDone }: Props) {
  const { copy, error } = useCopy();
  const download = () =>
    saveTextFile(RECOVERY_CODES_FILENAME, buildRecoveryCodesFile({ siteName, username, codes, now: new Date() }));
  return (
    <div className="recovery-panel" role="region" aria-label="恢复码">
      <Callout tone="warning" title="恢复码只显示这一次">
        {origin === "enable" ? "两步验证已启用。" : "新的恢复码已生成，之前的恢复码全部作废。"}
        丢失验证器时，每个恢复码可以登录一次。现在就复制或下载保存，离开此页后无法再次查看。
      </Callout>
      <ul className="recovery-grid" aria-label="恢复码列表">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      {error ? <Callout tone="danger" title="复制失败">{error}。可以改用“下载”，或手动选中恢复码抄写。</Callout> : null}
      <div className="form-actions">
        <Button onClick={() => void copy(codes.join("\n"), "恢复码已复制")}><Copy />复制全部</Button>
        <Button onClick={download}><Download />下载为文本文件</Button>
        <Button variant="primary" onClick={onDone}>我已保存，完成</Button>
      </div>
    </div>
  );
}
