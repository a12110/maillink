import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../../api/instance";
import { queryKeys } from "../../../api/queries";
import { TESTER_DEBOUNCE_MS } from "../../../constants";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { validateLive } from "../editor/editor-state";
import { errorsOf, issuesFromApiError } from "../issues";
import { buildTestRequest, parseTarget } from "./tester-state";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 用当前未保存的配置试跑（02 §8）：配置、地址、锚点都防抖，停手后才发请求。
 * 配置本地校验有错误时不发（服务端会同样拒绝），界面保留上一份结果并说明。
 */
export function useRuleGroupTest(config: unknown, targetText: string, anchorAt: number | undefined) {
  const inputs = useMemo(() => ({ config, targetText, anchorAt }), [config, targetText, anchorAt]);
  const settled = useDebouncedValue(inputs, TESTER_DEBOUNCE_MS);
  const parsed = parseTarget(settled.targetText);
  const blocking = useMemo(() => errorsOf(validateLive(settled.config)).length, [settled.config]);
  const request = parsed.ok && isRecord(settled.config) ? buildTestRequest(settled.config, parsed.target, settled.anchorAt) : null;
  const enabled = request !== null && blocking === 0;
  const query = useQuery({
    queryKey: [...queryKeys.adminRuleGroups, "test", request] as const,
    queryFn: () => {
      if (request === null) throw new Error("测试器在没有请求体时被调用");
      return api.testRuleGroup(request);
    },
    enabled,
    placeholderData: keepPreviousData,
    gcTime: TESTER_DEBOUNCE_MS,
  });
  return {
    query,
    targetError: parsed.ok ? null : parsed.error,
    blocking,
    /** 有改动还在防抖等待中 */
    pending: settled.config !== config || settled.targetText !== targetText || settled.anchorAt !== anchorAt,
    serverIssues: query.isError ? issuesFromApiError(query.error) : null,
    enabled,
  };
}
