import { budgetTable, overBudget, rateLimitMax, readBudgetCounts } from "./budget";

/** 整次运行结束后核对限流预算；超了就让这次运行失败，并说明怎么降 */
export default function globalTeardown(): void {
  const counts = readBudgetCounts();
  const max = rateLimitMax();
  console.log(budgetTable(counts, max));
  const over = overBudget(counts, max);
  if (over.length > 0) {
    throw new Error(
      `认证请求超出限流预算（整套用例只有几十秒，可能落在同一个 60 秒窗口，超出就会偶发 429）：\n${over.join("\n")}\n` +
        "请复用已有会话（test.use({ storageState })、VIEWER_STATE）或合并登录步骤，把这一类的次数降下来。",
    );
  }
}
