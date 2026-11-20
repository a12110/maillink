import { z } from "zod";

// 关掉 zod 的 JIT：否则它会用 new Function("") 探测能否 eval，在页面 CSP（script-src 不含 'unsafe-eval'）下
// 触发一条 script-src 违规报告。jitless 只影响 zod 内部的快速路径，校验结果不变。
// 必须在任何 schema 第一次 parse 之前执行，所以 main.tsx 第一个导入它。
z.config({ jitless: true });
