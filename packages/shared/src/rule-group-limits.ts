// 规则组相关的上限与默认值，前后端共用。
// 前六项来自 docs/design/02-rule-engine.md §7；其余为实现补充（设计文档未给出），理由见各条注释。

/** 当前规则组配置的 schema 版本；不认识的版本一律失败关闭 */
export const RULE_GROUP_SCHEMA_VERSION = 1;

export const RULE_GROUP_LIMITS = {
  /** 每个规则组的规则数（02 §7） */
  maxRules: 30,
  /** 每个规则组的条件叶子数，含停用规则（02 §7） */
  maxLeaves: 60,
  /** 条件嵌套深度：从 when 到叶子经过的 all / any / not 节点数（02 §7） */
  maxDepth: 3,
  /** value 数组长度（02 §7） */
  maxValueItems: 200,
  /** 单个正则的长度，按归一化后的字符数计（02 §7） */
  maxRegexLength: 200,
  /** 脱敏规则数（02 §7） */
  maxRedactions: 20,
  /** 补充：整个规则组里正则的总数。保存时每个正则都要试跑计时，需要给总工作量一个上界 */
  maxRegexPatterns: 60,
  /** 补充：单个文本取值、脱敏文本的长度 */
  maxTextValueLength: 500,
  /** 补充：规则名、脱敏规则名的长度 */
  maxNameLength: 100,
  /** 补充：规则 id 的长度 */
  maxIdLength: 64,
  /** 补充：links.allow_domains 的条数 */
  maxAllowDomains: 100,
  /** 补充：脱敏替换文本的长度 */
  maxReplaceLength: 100,
  /** 补充：所有"分钟"类配置的上限（10 年），防止溢出与误填 */
  maxMinutes: 5_256_000,
  /** 补充：limits.max_mails 的上限 */
  maxMailsCap: 1000,
  /**
   * 补充：结构校验前对原始输入做的嵌套深度预检。超过这个深度直接拒绝，不交给递归的 zod 解析，
   * 防止恶意的超深 JSON 打爆调用栈。正常的深度上限（maxDepth）在语义校验里报。
   */
  rawDepthGuard: 16,
} as const;

/**
 * 提取出的验证码（去掉空格与连字符后）的最大长度；超过视为该步提取无效，防止 code_only 视图借"验证码"泄露正文。
 * 验证码通常 4–8 位；一句话去掉空格后也是"字母数字串"，所以上限不能太宽。
 */
export const EXTRACTED_CODE_MAX_LENGTH = 16;

/** 列表预览（snippet）最多保留的字符数（按 Unicode 码点计） */
export const SNIPPET_MAX_CHARS = 200;

/** links = strip / 不在 allow_domains 内时，纯文本里的 URL 被替换成的文字（02 §4.3） */
export const LINK_HIDDEN_PLACEHOLDER = "[链接已隐藏]";

/** 收件地址打码时替换本地部分的固定文字（固定长度，不泄露原长度） */
export const ADDRESS_MASK = "***";

/** 收件地址打码时本地部分最多保留的前缀字符数；且不超过本地部分长度的一半 */
export const ADDRESS_MASK_KEEP_CHARS = 2;

// ---- 正则试跑（02 §7 防灾难性回溯）----
// 样本 = 重复单元拼到指定长度 + 终止符。短长度用于暴露指数级回溯，长长度（到正文上限）用于暴露多项式级回溯。
// 最长样本与 worker 的 BODY_INDEX_CAP_BYTES（32768）对齐：被匹配文本不会更长。

/** 单次试跑（一个样本）允许的最长耗时（毫秒），超过即判定为可能灾难性回溯 */
export const REGEX_PROBE_MAX_RUN_MS = 25;

/** 试跑样本的重复单元：覆盖字母、数字、空白、混合、中文、标点 */
export const REGEX_PROBE_UNITS: readonly string[] = ["a", "1", " ", "a1", "a ", "1 ", "1-", "验", "."];

/** 试跑样本长度，递增；一旦某次超时立即停止，所以最坏耗时约为阈值的几倍 */
export const REGEX_PROBE_LENGTHS: readonly number[] = [
  12, 16, 20, 22, 24, 26, 28, 30, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
];

/** 样本末尾追加的终止符，让"必须匹配到结尾"的模式失败并触发回溯 */
export const REGEX_PROBE_TERMINATOR = "!";

/** 计时器自检：最多做多少轮固定工作来确认时钟会前进（Workers 线上环境计算期间时钟冻结） */
export const CLOCK_CALIBRATION_MAX_ROUNDS = 200;

/** 计时器自检每轮工作所用文本的长度 */
export const CLOCK_CALIBRATION_TEXT_CHARS = 4096;
