// 只给 e2e 用：通过 `node --import` 预加载，让 apps/worker/scripts/seed-mail-db.ts 把种子写进本次运行的临时目录。
// 该脚本把 wrangler 的参数写死、没有 --persist-to 入口，而本轮不改 apps/worker；
// 这里包一层 child_process.execFileSync，只允许它执行"wrangler d1 execute MAIL_DB --local"，并追加 --persist-to。
// 任何别的命令都直接抛错，种子脚本一次也没调用 wrangler 时进程以非零退出（不静默跳过）。

import childProcess, { type ExecFileSyncOptions } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import process from "node:process";

const persistTo = process.env["E2E_PERSIST_TO"];
if (!persistTo) throw new Error("persist-to-hook: 缺少环境变量 E2E_PERSIST_TO");

const original = childProcess.execFileSync;
let injected = 0;

function isMailDbSeed(file: string, args: readonly string[]): boolean {
  return (
    file.endsWith("/wrangler") &&
    args[0] === "d1" &&
    args[1] === "execute" &&
    args[2] === "MAIL_DB" &&
    args.includes("--local") &&
    !args.includes("--remote")
  );
}

function patched(file: string, args: readonly string[] = [], options?: ExecFileSyncOptions): Buffer | string {
  if (!isMailDbSeed(file, args)) {
    throw new Error(`persist-to-hook: 种子脚本执行了预期之外的命令：${file} ${args.join(" ")}`);
  }
  injected += 1;
  return original(file, [...args, "--persist-to", persistTo as string], options);
}

Reflect.set(childProcess, "execFileSync", patched);
syncBuiltinESMExports();

process.on("exit", (code) => {
  if (code === 0 && injected !== 1) {
    console.error(`persist-to-hook: 预期执行 1 次 wrangler d1 execute，实际 ${injected} 次`);
    process.exitCode = 1;
  }
});
