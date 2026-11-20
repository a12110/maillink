import { addressForms } from "./addresses";
import { requireMailSchema } from "./guard";
import { parseD1Utc } from "./time";

// 收件地址列表的"最近来信时间"：按地址批量取 MAX(created_at)，只读。
// 地址的每种写法各做两次 MAX 子查询（to_address 命中 / to_address 为空时 address 命中），
// 与 candidates.ts 的收件人匹配口径一致，并且各自都能走 address / to_address 索引。

const MS_PER_SECOND = 1000;

type Row = { form: string; last: string | null };

function buildSql(hasToAddress: boolean): string {
  const byAddress = hasToAddress
    ? "(SELECT MAX(created_at) FROM raw_mails WHERE address = j.value AND (to_address IS NULL OR to_address = ''))"
    : "(SELECT MAX(created_at) FROM raw_mails WHERE address = j.value)";
  if (!hasToAddress) return `SELECT j.value AS form, ${byAddress} AS last FROM json_each(?1) j`;
  const byToAddress = "(SELECT MAX(created_at) FROM raw_mails WHERE to_address = j.value)";
  // 多参数 MAX 遇到 NULL 返回 NULL，所以先各自 COALESCE 成空串（比任何时间文本都小），最后把空串还原成 NULL
  return `SELECT j.value AS form, NULLIF(MAX(COALESCE(${byToAddress}, ''), COALESCE(${byAddress}, '')), '') AS last FROM json_each(?1) j`;
}

/** 返回以输入地址为键的最近来信时间（Unix 秒）；没有邮件为 null */
export async function getLastReceivedAt(db: D1Database, addresses: readonly string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (addresses.length === 0) return result;
  const capabilities = (await requireMailSchema(db)).capabilities;
  const forms = [...new Set(addresses.flatMap(addressForms))];
  const { results } = await db.prepare(buildSql(capabilities.to_address)).bind(JSON.stringify(forms)).all<Row>();
  const byForm = new Map(results.map((row) => [row.form, row.last]));
  for (const address of addresses) {
    const latest = addressForms(address)
      .map((form) => byForm.get(form) ?? null)
      .filter((value): value is string => value !== null)
      .map((text) => Math.floor(parseD1Utc(text) / MS_PER_SECOND));
    result.set(address, latest.length === 0 ? null : Math.max(...latest));
  }
  return result;
}
