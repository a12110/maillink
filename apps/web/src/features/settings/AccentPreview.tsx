import { Status, Tag, Button } from "../../ui";
import { isHexColor, reportAccent } from "./accent-report";
import type { ModeReport } from "./accent-report";

const MODE_LABEL = { light: "浅色", dark: "深色" } as const;
const RATIO_DIGITS = 2;

function ReportRow({ report, requested }: { report: ModeReport; requested: string }) {
  if (!report.ok) {
    return (
      <li>
        <Status tone="danger">{MODE_LABEL[report.mode]}主题：无法保证对比度</Status>
        <p className="field-error">{report.message}</p>
      </li>
    );
  }
  return (
    <li>
      <Status tone="success">{MODE_LABEL[report.mode]}主题：按钮 {report.derived.accent}，文字用{report.foreground}（{report.buttonContrast.toFixed(RATIO_DIGITS)}:1）</Status>
      <p className="field-hint">
        强调色作文字 {report.derived.text}（对底色最低 {report.textContrast.toFixed(RATIO_DIGITS)}:1）
        {report.adjusted ? `；${requested} 对底色对比度不足，已自动调整为 ${report.derived.accent}` : ""}
      </p>
    </li>
  );
}

/** 强调色在明暗两套主题下推导出的颜色与可读性（用 shared 的算法，与服务端保存前的检查同一份） */
export function AccentReadout({ accent }: { accent: string }) {
  if (!isHexColor(accent)) return <p className="field-hint">输入完整的 #rrggbb 后显示对比度检查。</p>;
  return (
    <ul className="accent-report" aria-label="强调色可读性">
      {reportAccent(accent).map((report) => (
        <ReportRow key={report.mode} report={report} requested={accent.toLowerCase()} />
      ))}
    </ul>
  );
}

/** 预览：取件卡片 + 表格行，用的就是真实组件与语义变量，随页面主题即时变化 */
export function AppearancePreview() {
  return (
    <div className="appearance-preview" aria-label="外观预览">
      <div className="card card-pad preview-pickup">
        <p className="preview-meta">来自 no-reply@example.com · 3 分钟前</p>
        <p className="preview-code" aria-label="示例验证码">482 915</p>
        <div className="form-actions">
          <Button variant="primary">复制验证码</Button>
          <Button>刷新</Button>
          <button type="button" className="text-action preview-link">打开登录链接</button>
        </div>
      </div>
      <div className="panel">
        <table className="table">
          <colgroup><col data-w="xl" /><col /><col data-w="sm" /></colgroup>
          <tbody>
            <tr><td className="mono-cell">alice@example.com</td><td>示例规则组</td><td><Tag tone="success">可见</Tag></td></tr>
            <tr><td className="mono-cell">bob@example.com</td><td>另一个规则组</td><td><Tag>已停用</Tag></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
