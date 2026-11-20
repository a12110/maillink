import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SHARE_LINK_LIMITS } from "@maillink/shared";
import type { AdminShareLink } from "@maillink/shared";
import { api } from "../../api/instance";
import { linkKeys } from "../../api/links-queries";
import { describeError } from "../../lib/messages";
import { Button, Callout, ConfirmDialog, ErrorCallout, FormDialog, useToast } from "../../ui";
import { apiCodeUrlFromLink } from "./api-code";
import { LinkUrlBox } from "./LinkUrlBox";
import { MailboxPicker } from "./MailboxPicker";
import type { PickedMailbox } from "./MailboxPicker";
import { linkTitle } from "./labels";

type OpProps = { link: AdminShareLink; onClose: () => void };

/** 复制链接：取完整 token 会写审计，先说明再取 */
export function CopyLinkDialog({ link, onClose }: OpProps) {
  const token = useMutation({ mutationFn: () => api.linkToken(link.id) });
  const queryClient = useQueryClient();
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="复制取件链接"
      description={`${linkTitle(link)} · 取得完整链接会写入审计日志（记录谁在什么时间取了这条链接）。链接等同买家的取件凭证，请只发给买家本人。`}
      footer={
        token.data ? (
          <Button variant="primary" onClick={onClose}>完成</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={token.isPending}>取消</Button>
            <Button variant="primary" busy={token.isPending} busyLabel="取得中…" onClick={() => token.mutate(undefined, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: linkKeys.all }) })}>
              取得并复制链接
            </Button>
          </>
        )
      }
    >
      {token.isError ? <ErrorCallout title="取得链接失败" {...describeError(token.error)} /> : null}
      {token.data ? <LinkUrlBox url={token.data.url} autoCopy /> : null}
      {token.data && link.access.api ? <ApiUrlBox linkUrl={token.data.url} /> : null}
    </FormDialog>
  );
}

/** 允许 API 取码时，在完整链接下面给出带完整 token 的接口地址（同样只在这里出现） */
function ApiUrlBox({ linkUrl }: { linkUrl: string }) {
  const url = apiCodeUrlFromLink(linkUrl);
  if (url === null) return null;
  return (
    <div className="field">
      <span className="field-label">API 取码地址</span>
      <LinkUrlBox url={url} label="完整 API 取码地址" />
    </div>
  );
}

const RESET_FLAGS = [
  { key: "reset_anchor", label: "重置起始时间", hint: "规则组里“从首次访问 / 从重置起算”的时间窗口重新开始计时" },
  { key: "reset_devices", label: "清空已登记的设备", hint: "买家需要重新点“开始取码”，重新占用设备名额" },
  { key: "reset_deliveries", label: "清空取码记录", hint: "已用的取码次数归零，之前取过的邮件需要重新点击查看" },
] as const;

type Flags = Record<(typeof RESET_FLAGS)[number]["key"], boolean>;
const NO_FLAGS: Flags = { reset_anchor: false, reset_devices: false, reset_deliveries: false };

function FlagChecks({ flags, onChange }: { flags: Flags; onChange: (flags: Flags) => void }) {
  return (
    <fieldset className="check-group">
      <legend className="field-label">换绑时同时（可选）</legend>
      {RESET_FLAGS.map((flag) => (
        <label key={flag.key} className="check-row">
          <input type="checkbox" checked={flags[flag.key]} onChange={(event) => onChange({ ...flags, [flag.key]: event.target.checked })} />
          <span>
            <b>{flag.label}</b>
            <span className="field-hint">{flag.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** 换绑收件地址：卖出的账号换了登录邮箱，链接不变 */
export function RebindDialog({ link, onClose }: OpProps) {
  const [picked, setPicked] = useState<PickedMailbox[]>(link.mailboxes.map((mailbox) => ({ id: mailbox.id, address: mailbox.address })));
  const [flags, setFlags] = useState<Flags>(NO_FLAGS);
  const queryClient = useQueryClient();
  const toast = useToast();
  const rebind = useMutation({
    mutationFn: () => api.rebindLink(link.id, { mailbox_ids: picked.map((item) => item.id), ...flags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: linkKeys.all });
      toast.success("已换绑收件地址");
      onClose();
    },
  });
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title="换绑收件地址" description={`${linkTitle(link)} · 链接不变，买家之后看到的是新地址的邮件。`}
      footer={
        <>
          <Button onClick={onClose} disabled={rebind.isPending}>取消</Button>
          <Button variant="primary" disabled={picked.length === 0} busy={rebind.isPending} busyLabel="换绑中…" onClick={() => rebind.mutate()}>换绑</Button>
        </>
      }
    >
      <MailboxPicker value={picked} onChange={setPicked} max={SHARE_LINK_LIMITS.mailboxesPerLink} />
      <FlagChecks flags={flags} onChange={setFlags} />
      {rebind.isError ? <ErrorCallout title="换绑失败" {...describeError(rebind.error)} /> : null}
    </FormDialog>
  );
}

/** 重置设备：清空已登记的设备（link_visitors） */
export function ResetDevicesDialog({ link, onClose }: OpProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const reset = useMutation({
    mutationFn: () => api.resetLink(link.id, { reset_devices: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: linkKeys.all });
      toast.success("已重置设备");
      onClose();
    },
  });
  return (
    <ConfirmDialog open onOpenChange={(open) => !open && onClose()} title="重置设备？" variant="danger"
      consequence={`清空已登记的 ${link.device_count} 台设备。买家下次打开链接需要重新点“开始取码”（需要口令的还要再输入口令），并重新占用设备名额。链接本身与取码次数不变。`}
      confirmLabel="重置设备" busyLabel="重置中…" busy={reset.isPending} error={reset.isError ? describeError(reset.error) : null} onConfirm={() => reset.mutate()} />
  );
}

/** 重置 token：旧链接立即作废，得到新链接（只此一次显示） */
export function RotateDialog({ link, onClose }: OpProps) {
  const [clearDevices, setClearDevices] = useState(false);
  const queryClient = useQueryClient();
  const rotate = useMutation({
    mutationFn: () => api.rotateLink(link.id, { reset_devices: clearDevices }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: linkKeys.all }),
  });
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title="重置 token？" description={`${linkTitle(link)} · 用于链接被转发或泄露的情况。`}
      footer={
        rotate.data ? (
          <Button variant="primary" onClick={onClose}>完成</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={rotate.isPending}>取消</Button>
            <Button variant="danger" busy={rotate.isPending} busyLabel="重置中…" onClick={() => rotate.mutate()}>重置 token</Button>
          </>
        )
      }
    >
      {rotate.data ? (
        <>
          <Callout tone="warning" title="新链接只在这里显示一次">关闭后需要时用“复制链接”（会写审计）。旧链接已经失效。</Callout>
          <LinkUrlBox url={rotate.data.url} autoCopy />
        </>
      ) : (
        <>
          <p className="consequence">旧链接立即失效，买家打开旧链接会看到“链接不存在”；你需要把新链接重新发给买家。</p>
          <label className="check-row">
            <input type="checkbox" checked={clearDevices} onChange={(event) => setClearDevices(event.target.checked)} />
            <span>
              <b>同时清空已登记的设备</b>
              <span className="field-hint">泄露的链接可能已被别人登记为设备；清空后正当买家用新链接重新登记。</span>
            </span>
          </label>
          {rotate.isError ? <ErrorCallout title="重置失败" {...describeError(rotate.error)} /> : null}
        </>
      )}
    </FormDialog>
  );
}
