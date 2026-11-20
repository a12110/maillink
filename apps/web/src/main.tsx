import "./zod-config";
import "./styles/index.css";

// 应用代码（含 @maillink/shared 的 schema）要在 zod-config 之后才求值：zod 在构造第一个 object schema 时就探测 eval。
// 静态导入时打包器会把 shared 与 zod 放进同一个公共 chunk，先于本文件执行，z.config 来不及生效，所以这里动态导入。
// 加载失败时 promise 拒绝会作为未处理的错误出现在控制台，不吞掉。
void import("./app/bootstrap").then(({ bootstrap }) => bootstrap());
