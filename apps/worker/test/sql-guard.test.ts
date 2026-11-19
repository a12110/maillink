import { describe, expect, it } from "vitest";
import { findViolations, stripComments } from "./sql-guard";

const rulesHit = (source: string) => findViolations(source).map((violation) => violation.rule);

describe("stripComments", () => {
  it("去掉行注释与块注释", () => {
    expect(stripComments("a // DELETE FROM x\nb")).toBe("a \nb");
    expect(stripComments("a /* DROP TABLE x */ b")).toBe("a   b");
    expect(stripComments("/**\n * INSERT INTO x\n */\nconst a = 1;")).toBe(" \nconst a = 1;");
  });

  it("字符串里的 // 不是注释，不会吞掉后面的代码", () => {
    const source = 'const url = "http://example.test"; db.prepare("DELETE FROM raw_mails");';
    expect(stripComments(source)).toBe(source);
    expect(rulesHit(source)).toContain("DELETE 语句");
  });

  it("字符串里的 /* 不是注释，不会吞掉后面的代码（直到出现 */）", () => {
    const source = 'const a = "/*"; db.prepare("DROP TABLE raw_mails"); const b = "*/";';
    expect(stripComments(source)).toBe(source);
    expect(rulesHit(source)).toContain("DROP 语句");
  });

  it("单引号、反引号字符串同样处理，转义的引号不会提前结束字符串", () => {
    expect(stripComments("const a = '//'; x")).toBe("const a = '//'; x");
    expect(stripComments("const a = `//\n/*`; x")).toBe("const a = `//\n/*`; x");
    expect(stripComments('const a = "say \\"//\\" now"; x')).toBe('const a = "say \\"//\\" now"; x');
  });

  it("带违规 SQL 的源码经过去注释后仍能被抓到", () => {
    const source = [
      "// 只读模块",
      "/* 不要写库 */",
      'db.prepare("UPDATE raw_mails SET is_unread = 0"); // 标记已读',
    ].join("\n");
    expect(rulesHit(source)).toEqual(expect.arrayContaining(["UPDATE 语句"]));
  });

  it("没有结束符的块注释吞到文件末尾，不死循环", () => {
    expect(stripComments("a /* never closed DELETE FROM x")).toBe("a  ");
  });

  it("未闭合的单引号字符串在行尾终止，下一行的代码仍被扫描", () => {
    const source = "const re = /'/;\ndb.prepare(\"DELETE FROM x\");";
    expect(rulesHit(source)).toContain("DELETE 语句");
  });
});

describe("findViolations：必须抓到的写操作", () => {
  const MUST_FLAG: Array<[string, string]> = [
    ["INSERT", 'db.prepare("INSERT INTO t VALUES (1)")'],
    ["小写 insert", 'db.prepare("insert into t values (1)")'],
    ["INSERT OR REPLACE", 'db.prepare("INSERT OR REPLACE INTO t VALUES (1)")'],
    ["UPDATE", 'db.prepare("UPDATE t SET a = 1")'],
    ["小写 update", 'db.prepare("update t set a = 1")'],
    ["DELETE", 'db.prepare("DELETE FROM t")'],
    ["小写 delete", 'db.prepare("delete from t")'],
    ["REPLACE INTO", 'db.prepare("REPLACE INTO t VALUES (1)")'],
    ["小写 replace into", 'db.prepare("replace into t values (1)")'],
    ["ALTER", 'db.prepare("ALTER TABLE t ADD COLUMN c")'],
    ["DROP", 'db.prepare("DROP TABLE t")'],
    ["CREATE TABLE", 'db.prepare("CREATE TABLE t (a)")'],
    ["CREATE INDEX", 'db.prepare("create unique index i on t(a)")'],
    ["PRAGMA 赋值", 'db.prepare("PRAGMA journal_mode = WAL")'],
    ["PRAGMA 赋值（无空格）", 'db.prepare("PRAGMA foreign_keys=OFF")'],
    ["PRAGMA 函数写法赋值", 'db.prepare("PRAGMA journal_mode(WAL)")'],
    ["小写 pragma 函数写法", 'db.prepare("pragma foreign_keys(0)")'],
    ["PRAGMA 无参数形式", 'db.prepare("PRAGMA optimize")'],
    ["PRAGMA 带库名前缀", 'db.prepare("PRAGMA main.user_version = 3")'],
    ["PRAGMA 读取但不在白名单", 'db.prepare("PRAGMA index_list(raw_mails)")'],
    ["VACUUM", 'db.prepare("VACUUM")'],
    ["REINDEX", 'db.prepare("REINDEX t")'],
    ["ATTACH DATABASE", 'db.prepare("ATTACH DATABASE \'x.db\' AS other")'],
    ["ATTACH ... AS", 'db.prepare("ATTACH \'x.db\' AS other")'],
    ["多行模板字符串里的 DELETE", "db.prepare(`DELETE\n  FROM t`)"],
  ];

  for (const [name, source] of MUST_FLAG) {
    it(name, () => {
      expect(findViolations(source), source).not.toEqual([]);
    });
  }
});

describe("findViolations：不能误报的普通代码", () => {
  const MUST_PASS: Array<[string, string]> = [
    ["Cache.delete 方法调用", "await cache.delete(request);"],
    ["Map.delete / Set.delete", "map.delete(key); set.delete(item);"],
    ["String.replace", 'name.replace(/_/g, " ").replace("a", "into");'],
    ["replace 后换行再出现 into 单词的变量", "const into = text.replace(\n  /x/, 'y');"],
    ["Array 的 update/drop 之类小写标识符", "const update = 1; const drop = 2; const create = 3; function insert() {}"],
    ["PRAGMA 读取", 'db.prepare(`PRAGMA table_info(${table})`)'],
    ["PRAGMA table_info(raw_mails)", 'db.prepare("PRAGMA table_info(raw_mails)")'],
    ["PRAGMA 读取（带参数）", 'db.prepare("PRAGMA table_xinfo(raw_mails)")'],
    ["小写且括号前有空格", 'db.prepare("pragma table_info (raw_mails)")'],
    ["普通查询", 'db.prepare("SELECT id FROM raw_mails WHERE id > ?1 ORDER BY id LIMIT 20")'],
    ["标识符 attachments / attachment", "const attachments = []; row.attachment_count;"],
    ["含关键字子串的大写常量", "const UPDATE_INTERVAL = 1; const DELETED_AT = 2;"],
    ["注释里的写操作说明", "// 不得出现 INSERT / DELETE\n/* DROP TABLE 也不行 */\nconst a = 1;"],
  ];

  for (const [name, source] of MUST_PASS) {
    it(name, () => {
      expect(findViolations(source), source).toEqual([]);
    });
  }
});
