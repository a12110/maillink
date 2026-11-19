import * as RadixDialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import type { ButtonVariant } from "./Button";
import { ErrorCallout } from "./Feedback";

type FormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** 表单类对话框：Radix 提供焦点陷阱、Esc 与读屏语义 */
export function FormDialog({ open, onOpenChange, title, description, children, footer }: FormDialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay" />
        <RadixDialog.Content className="dialog">
          <div className="dialog-head">
            <RadixDialog.Title className="dialog-title">{title}</RadixDialog.Title>
          </div>
          <div className="dialog-body">
            <RadixDialog.Description className="dialog-desc">{description}</RadixDialog.Description>
            {children}
          </div>
          {footer ? <div className="dialog-foot">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 必须写明后果，如“该用户的全部会话会失效” */
  consequence: string;
  confirmLabel: string;
  busyLabel: string;
  variant?: Extract<ButtonVariant, "danger" | "primary" | "secondary">;
  busy: boolean;
  error?: { message: string; detail: string } | null;
  onConfirm: () => void;
};

/** 二次确认：确认键不自动关闭，由调用方在成功后关；失败就地显示错误并留在对话框里 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onOpenChange, title, consequence, confirmLabel, busyLabel, variant = "danger", busy, error, onConfirm } = props;
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="dialog">
          <div className="dialog-head">
            <AlertDialog.Title className="dialog-title">{title}</AlertDialog.Title>
          </div>
          <div className="dialog-body">
            <AlertDialog.Description className="consequence">{consequence}</AlertDialog.Description>
            {error ? <ErrorCallout title="操作失败" message={error.message} detail={error.detail} /> : null}
          </div>
          <div className="dialog-foot">
            <AlertDialog.Cancel asChild>
              <Button disabled={busy}>取消</Button>
            </AlertDialog.Cancel>
            <Button variant={variant} busy={busy} busyLabel={busyLabel} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function CloseIconButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" iconOnly aria-label={label} title={label} onClick={onClick}>
      <X />
    </Button>
  );
}
