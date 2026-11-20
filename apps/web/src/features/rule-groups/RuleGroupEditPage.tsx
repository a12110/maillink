import { useQuery } from "@tanstack/react-query";
import type { AdminRuleGroupDetail } from "@maillink/shared";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { api } from "../../api/instance";
import { adminRuleGroupQuery } from "../../api/queries";
import type { RuleDraft } from "../../api/rule-draft";
import { describeError } from "../../lib/messages";
import { Callout, ErrorCallout } from "../../ui";
import { BLANK_CONFIG, configFromDraft, templateConfig } from "./config";
import { RuleGroupEditor } from "./editor/RuleGroupEditor";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

const editApi = getRouteApi("/workspace/admin/rule-groups/$id");
const newApi = getRouteApi("/workspace/admin/rule-groups/new");

function Loading() {
  return <span className="skeleton editor-skeleton" role="status" aria-label="正在加载规则组" />;
}

function BackLink() {
  return <Link className="text-action" to="/admin/rule-groups">回到规则组列表</Link>;
}

function ExistingEditor({ group }: { group: AdminRuleGroupDetail }) {
  const banner = group.invalid ? (
    <Callout tone="danger" title="这个规则组的配置现在无法通过校验" actions={<BackLink />}>
      引用它的链接和授权目前全部不可见（失败关闭）。下面的问题清单指出了要修的地方，保存通过校验的配置后立即恢复。
    </Callout>
  ) : null;
  return (
    <RuleGroupEditor
      key={group.id}
      existing={{ id: group.id, revision: group.revision, links: group.link_count, grants: group.grant_count }}
      initial={{ name: group.name, description: group.description ?? "", config: group.config ?? BLANK_CONFIG }}
      notes={group.config === null ? ["库里的配置不是合法 JSON，已用空白配置代替；保存会覆盖它"] : []}
      banner={banner}
      onCreated={() => undefined}
    />
  );
}

/** 编辑已有规则组：用服务端的配置与 revision 初始化编辑器 */
export function RuleGroupEditPage() {
  const { id: rawId } = editApi.useParams();
  const id = Number(rawId);
  const valid = Number.isSafeInteger(id) && id > 0;
  const query = useQuery({ ...adminRuleGroupQuery(valid ? id : 0), enabled: valid });
  useDocumentTitle(query.data ? `编辑规则组 · ${query.data.name}` : "编辑规则组");
  if (!valid) return <Callout tone="danger" title="规则组 id 不合法" actions={<BackLink />}>地址里的 “{rawId}” 不是正整数。</Callout>;
  if (query.isError) {
    return <ErrorCallout title="规则组加载失败" {...describeError(query.error)} onRetry={() => void query.refetch()} />;
  }
  return query.data ? <ExistingEditor group={query.data} /> : <Loading />;
}

function DraftEditor({ mailId }: { mailId: number }) {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["admin", "rule-groups", "draft", mailId] as const, queryFn: (): Promise<RuleDraft> => api.draftRuleFromMail(mailId), staleTime: Infinity, gcTime: 0 });
  if (query.isError) {
    return <ErrorCallout title="生成规则草稿失败" {...describeError(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) return <Loading />;
  const built = configFromDraft(query.data);
  if (!built) {
    return (
      <Callout tone="warning" title="这封邮件没有足够的信息生成规则" actions={<Link className="text-action" to="/admin/mails" search={{ id: mailId }}>回到这封邮件</Link>}>
        {query.data.notes.join("；")}
      </Callout>
    );
  }
  return (
    <RuleGroupEditor key={`mail-${mailId}`} existing={null} initial={{ name: built.name, description: `由邮件 #${mailId} 生成的草稿`, config: built.config }}
      notes={query.data.notes} onCreated={(id) => void navigate({ to: "/admin/rule-groups/$id", params: { id: String(id) }, replace: true })} />
  );
}

/** 新建：从模板、空白或“以此邮件创建规则”的草稿开始；保存之前不写库 */
export function NewRuleGroupPage() {
  const search = newApi.useSearch();
  const navigate = useNavigate();
  useDocumentTitle("新建规则组");
  if (search.from_mail !== undefined) return <DraftEditor mailId={search.from_mail} />;
  const key = search.template ?? "blank";
  const template = key === "blank" ? { name: "新规则组", description: "", config: BLANK_CONFIG } : templateConfig(key);
  if (!template) {
    return <Callout tone="danger" title={`没有名为 ${key} 的内置模板`} actions={<BackLink />}>回到列表重新选择模板。</Callout>;
  }
  const name = key === "blank" ? template.name : `${template.name} 副本`;
  return (
    <RuleGroupEditor key={key} existing={null} initial={{ name, description: "", config: template.config }}
      onCreated={(id) => void navigate({ to: "/admin/rule-groups/$id", params: { id: String(id) }, replace: true })} />
  );
}
