// 取件流水线（02 §5）：链接（M3b-2）、用户授权（M4）、规则测试器共用。
export {
  adminCompiledPolicy,
  compilePolicy,
  compileStoredPolicy,
  effectivePolicy,
  evaluateIndexed,
  fullAccessRuleGroupConfig,
  grantPolicy,
  type AccessScope,
  type EffectivePolicy,
} from "./policy";
export { listVisibleMails, listVisibleMailsTagged, type ListVisibleOptions, type TaggedVisibleList } from "./list";
export type { ParseBudget } from "./scan";
export { getVisibleAttachment, getVisibleMailDetail, type DetailOptions, type VisibleAttachment } from "./detail";
export { testRuleGroup, testRuleGroupTagged, type TaggedTestResult, type TestOptions, type TestResult, type TestTargets } from "./tester";
