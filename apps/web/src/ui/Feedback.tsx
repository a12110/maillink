import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tone = "info" | "warning" | "danger";

const TONE_ICON: Record<Tone, LucideIcon> = { info: Info, warning: TriangleAlert, danger: CircleAlert };

type CalloutProps = {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  /** 带“重试”等文字动作 */
  actions?: ReactNode;
};

/** 提示块：图标 + 加粗首句 + 后续原因 + 文字动作。danger 用 role=alert，其余 status */
export function Callout({ tone = "info", title, children, actions }: CalloutProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div className="callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon />
      <div className="callout-body">
        <b>{title}</b>
        {children ? <p>{children}</p> : null}
        {actions ? <div className="callout-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

type ErrorCalloutProps = { title: string; message: string; detail: string; onRetry?: () => void };

/** 加载失败 / 操作失败：就地 danger 提示块，写出原因与错误码，可重试 */
export function ErrorCallout({ title, message, detail, onRetry }: ErrorCalloutProps) {
  return (
    <Callout
      tone="danger"
      title={title}
      actions={
        onRetry ? (
          <button type="button" className="text-action" onClick={onRetry}>
            重试
          </button>
        ) : undefined
      }
    >
      {message}（{detail}）
    </Callout>
  );
}

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="icon-wrap">
        <Icon className="icon-lg" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Tag({ tone, children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  return (
    <span className="tag" data-tone={tone}>
      {children}
    </span>
  );
}

type StatusProps = { tone: "success" | "neutral" | "warning" | "danger"; children: ReactNode };

/** 状态点 + 文字（颜色不独自传义） */
export function Status({ tone, children }: StatusProps) {
  return (
    <span className="status" data-tone={tone === "danger" ? "danger" : undefined}>
      <span className="dot" data-tone={tone === "neutral" ? undefined : tone} aria-hidden="true" />
      {children}
    </span>
  );
}

export function SkeletonRows({ rows, columns }: { rows: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, col) => (
            <td key={col}>
              <span className="skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
