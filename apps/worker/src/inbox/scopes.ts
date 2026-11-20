import { grantPolicy, type AccessScope } from "../access";
import { ME_ALL_MAX_SCOPES } from "../constants";
import type { EffectiveGrantRow } from "../db/grants";
import { ApiError } from "../errors";
import { HTTP_SERVICE_UNAVAILABLE, HTTP_UNPROCESSABLE } from "../http-status";
import { computeTimeLowerBound, type CompiledRuleGroup } from "../rules";

// 授权 → 访问作用域（02 §5 的 resolveScope）。锚点：created_at = 授权创建时间，first_access_at = 授权首次访问，
// 授权没有 anchor_reset_at（null）。

export function grantAnchors(grant: EffectiveGrantRow): AccessScope["anchors"] {
  return { created_at: grant.created_at, first_access_at: grant.first_access_at, anchor_reset_at: null };
}

/** 编译授权的策略；失效一律失败关闭，抛带明确错误码的 503（rule_group_id 为空 = 完整访问） */
export function compileGrant(grant: EffectiveGrantRow): CompiledRuleGroup {
  if (grant.rule_group_id !== null && grant.rule_group_config === null) {
    // 外键本应保证规则组存在；缺失时绝不能当成"完整访问"
    throw new ApiError(HTTP_SERVICE_UNAVAILABLE, "rule_group_invalid", "授权引用的规则组不存在，相关邮件暂不可见");
  }
  return grantPolicy(grant.rule_group_config);
}

/** 同上，但失效时记日志并返回 null：用于"全部"与邮箱列表，让一个失效的授权不拖垮其余授权 */
export function tryCompileGrant(grant: EffectiveGrantRow): CompiledRuleGroup | null {
  try {
    return compileGrant(grant);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    console.error(`授权 ${grant.id} 的规则组不可用（${error.code}），该邮箱暂不可见：${error.message}`);
    return null;
  }
}

export function singleScope(grant: EffectiveGrantRow): AccessScope {
  return { addresses: [grant.address], policy: compileGrant(grant), anchors: grantAnchors(grant) };
}

/**
 * "全部"的作用域：规则组相同且时间下界相同的授权合成一个作用域（多个地址）。
 * 时间下界要一起比：subject_created / first_access 锚点按授权各有各的，下界不同就不能共用一个锚点。
 * 设了 max_mails 的授权各占一个作用域：那是"该邮箱最新 N 封"，合并后就变成"所有邮箱合起来的 N 封"。
 * 这样"全部"恰好是各授权单独视图的并集。规则组失效的授权被跳过（邮箱列表里标 available=false）。
 */
export function buildAllScopes(grants: readonly EffectiveGrantRow[], now: number): AccessScope[] {
  const groups = new Map<string, AccessScope>();
  const compiledByGroup = new Map<number | null, CompiledRuleGroup | null>();
  for (const grant of grants) {
    if (!compiledByGroup.has(grant.rule_group_id)) compiledByGroup.set(grant.rule_group_id, tryCompileGrant(grant));
    const compiled = compiledByGroup.get(grant.rule_group_id);
    if (!compiled) continue;
    const anchors = grantAnchors(grant);
    const key =
      compiled.config.limits.max_mails === undefined
        ? `${grant.rule_group_id ?? "full"}|${computeTimeLowerBound(compiled.config.time, anchors, now) ?? "none"}`
        : `grant|${grant.id}`;
    const scope = groups.get(key);
    if (scope) scope.addresses.push(grant.address);
    else groups.set(key, { addresses: [grant.address], policy: compiled, anchors });
  }
  if (groups.size > ME_ALL_MAX_SCOPES) {
    throw new ApiError(
      HTTP_UNPROCESSABLE,
      "too_many_scopes",
      `授权的规则组组合超过 ${ME_ALL_MAX_SCOPES} 种，无法合并为"全部"，请选择具体邮箱`,
    );
  }
  return [...groups.values()];
}
