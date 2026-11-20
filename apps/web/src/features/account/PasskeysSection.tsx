import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { passkeyNameSchema, PASSKEY_NAME_MAX_LENGTH } from "@maillink/shared";
import type { MeResponse, MyPasskey } from "@maillink/shared";
import { api } from "../../api/instance";
import { publicConfigQuery } from "../../api/queries";
import { authQueryKeys, myPasskeysQuery } from "../../api/queries-auth";
import { describeAuthError } from "../../lib/auth-messages";
import { formatDateTime } from "../../lib/format";
import { browserWebAuthn } from "../../lib/webauthn";
import type { WebAuthnClient } from "../../lib/webauthn";
import { Button, Callout, ConfirmDialog, ErrorCallout, FormDialog, TextField, useToast } from "../../ui";
import { PasskeyAddDialog } from "./PasskeyAddDialog";

type Dialog = { kind: "add" } | { kind: "rename"; passkey: MyPasskey } | { kind: "delete"; passkey: MyPasskey } | null;

function RenameForm({ passkey, onClose }: { passkey: MyPasskey; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(passkey.name);
  const [error, setError] = useState<string | undefined>();
  const rename = useMutation({
    mutationFn: (value: string) => api.renamePasskey(passkey.id, value),
    onSuccess: async () => {
      toast.success("名称已修改");
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.myPasskeys });
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = passkeyNameSchema.safeParse(name);
    setError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    if (parsed.success) rename.mutate(parsed.data);
  };
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <TextField label="名称" value={name} error={error} autoFocus maxLength={PASSKEY_NAME_MAX_LENGTH}
        onChange={(event) => setName(event.target.value)} />
      {rename.isError ? <ErrorCallout title="修改失败" {...describeAuthError(rename.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={rename.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={rename.isPending} busyLabel="保存中…">保存</Button>
      </div>
    </form>
  );
}

function PasskeyList({ items, onRename, onDelete }: { items: MyPasskey[]; onRename: (p: MyPasskey) => void; onDelete: (p: MyPasskey) => void }) {
  return (
    <ul className="item-list" aria-label="通行密钥列表">
      {items.map((passkey) => (
        <li key={passkey.id}>
          <Fingerprint className="icon-lg" aria-hidden="true" />
          <span className="item-main">
            <b>{passkey.name}</b>
            <span className="item-meta">
              创建于 {formatDateTime(passkey.created_at)} · {passkey.last_used_at === null ? "还没有用过" : `最近使用 ${formatDateTime(passkey.last_used_at)}`}
            </span>
          </span>
          <span className="item-actions">
            <Button size="sm" variant="ghost" onClick={() => onRename(passkey)}>改名</Button>
            <Button size="sm" variant="danger-ghost" onClick={() => onDelete(passkey)}>删除</Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function useDelete(onDone: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) => api.deletePasskey(id),
    onSuccess: async () => {
      toast.success("通行密钥已删除");
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.myPasskeys });
      onDone();
    },
  });
}

function Dialogs({ dialog, me, webauthn, remove, onClose }: {
  dialog: Dialog;
  me: MeResponse;
  webauthn: WebAuthnClient;
  remove: ReturnType<typeof useDelete>;
  onClose: () => void;
}) {
  if (dialog?.kind === "add") return <PasskeyAddDialog me={me} webauthn={webauthn} onClose={onClose} />;
  if (dialog?.kind === "rename") {
    return (
      <FormDialog open onOpenChange={(open) => !open && onClose()} title="修改通行密钥名称" description={`当前名称：${dialog.passkey.name}`}>
        <RenameForm passkey={dialog.passkey} onClose={onClose} />
      </FormDialog>
    );
  }
  if (dialog?.kind === "delete") {
    return (
      <ConfirmDialog open onOpenChange={(open) => !open && onClose()} title={`删除通行密钥“${dialog.passkey.name}”？`}
        consequence="删除后不能再用它登录，这台设备或安全密钥上的通行密钥也需要自行清理。至少要保留一种登录方式。"
        confirmLabel="删除" busyLabel="删除中…" busy={remove.isPending}
        error={remove.isError ? describeAuthError(remove.error) : null} onConfirm={() => remove.mutate(dialog.passkey.id)} />
    );
  }
  return null;
}

function Body({ list, onRename, onDelete }: { list: UseQueryResult<{ items: MyPasskey[] }>; onRename: (p: MyPasskey) => void; onDelete: (p: MyPasskey) => void }) {
  if (list.isError) return <ErrorCallout title="通行密钥加载失败" {...describeAuthError(list.error)} onRetry={() => void list.refetch()} />;
  if (!list.data) return null;
  if (list.data.items.length === 0) {
    return <p className="item-empty">还没有通行密钥。添加后，登录页的“使用通行密钥登录”就能用了。</p>;
  }
  return <PasskeyList items={list.data.items} onRename={onRename} onDelete={onDelete} />;
}

export function PasskeysSection({ me, webauthn = browserWebAuthn }: { me: MeResponse; webauthn?: WebAuthnClient }) {
  const list = useQuery(myPasskeysQuery());
  const config = useQuery(publicConfigQuery());
  const [dialog, setDialog] = useState<Dialog>(null);
  const remove = useDelete(() => setDialog(null));
  const enabled = config.data?.login_methods.includes("passkey") === true;

  return (
    <section aria-labelledby="passkeys-title" className="security-block">
      <div className="section-row">
        <h2 className="section-heading" id="passkeys-title">通行密钥</h2>
        <Button disabled={!enabled} onClick={() => setDialog({ kind: "add" })}>添加通行密钥</Button>
      </div>
      <p className="section-lead">用指纹、面容或安全密钥代替密码登录，防钓鱼。通行密钥登录视为已完成多重验证，不再询问验证码。</p>
      {!enabled && config.data ? <Callout title="管理员暂未开放通行密钥登录">已有的通行密钥可以查看和删除，暂时不能添加新的。</Callout> : null}
      <Body list={list} onRename={(passkey) => setDialog({ kind: "rename", passkey })}
        onDelete={(passkey) => { remove.reset(); setDialog({ kind: "delete", passkey }); }} />
      <Dialogs dialog={dialog} me={me} webauthn={webauthn} remove={remove} onClose={() => setDialog(null)} />
    </section>
  );
}
