import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: "md" | "sm" | "lg";
  block?: boolean;
  /** 仅图标按钮：必须同时给 aria-label */
  iconOnly?: boolean;
  /** 提交中：禁用并换成 busyLabel，宽度保持不变 */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  block,
  iconOnly,
  busy,
  busyLabel,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const content =
    busyLabel === undefined ? (
      children
    ) : (
      <span className="btn-swap">
        <span data-active={!busy}>{children}</span>
        <span data-active={Boolean(busy)}>{busyLabel}</span>
      </span>
    );
  return (
    <button
      type={type}
      className="btn"
      data-variant={variant}
      data-size={size}
      data-block={block ? "true" : undefined}
      data-icon={iconOnly ? "true" : undefined}
      disabled={disabled || busy}
      aria-busy={busy ? "true" : undefined}
      {...rest}
    >
      {content}
    </button>
  );
}
