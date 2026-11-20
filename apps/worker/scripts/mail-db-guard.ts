// MAIL_DB 访问守卫（AGENTS.md 硬性规则）：基于 TypeScript 编译器 API 的语法树 + 类型检查。
// 由 mail-db-guard.test.ts 在 `pnpm --filter worker test` 里执行（node --test）。
//
// 为什么用编译器 API 而不是 ESLint 自定义规则：判定"被调用的是从 mail-source/ 导入的函数"要按 import 绑定解析
// （含 mail-source/index.ts 的转导出），判定"这个值是 env"要看类型，两者都需要类型检查器；ESLint 规则要拿到类型
// 得给 typescript-eslint 开 type-aware 模式并改仓库根的共享 eslint 配置，而这里只需在 apps/worker 内建一个 Program。
//
// 范围：src/ 下除 mail-source/ 与 env.ts 之外的源码。规则：
// - mail_db_access：`x.MAIL_DB` 只能直接作为实参出现在"从 mail-source/ 导入的标识符"的调用里（按 import 绑定判定，
//   不按名字：同名方法、局部别名、对象上的同名属性都不算）；接收者只能是标识符或标识符链（c.env、dbs、ctx.dbs）。
// - mail_db_name / mail_db_string：其他位置出现 MAIL_DB 标识符（类型声明、解构、对象键），或内容恰好是 "MAIL_DB" 的字符串。
// - 下面几条针对"env 类值"（类型里有 MAIL_DB，或有声明在 env.ts Bindings 里的属性，例如 Pick<Bindings, "APP_SECRET">）：
//   env_computed_access：计算属性访问（env[k]、env["MAIL" + "_DB"]）；env_spread：展开、剩余解构、计算键解构；
//   env_escape：交给声明在 src 之外的函数（Object.values/entries/assign、JSON.stringify、console.log、new Proxy…）或 for…in；
//   env_erasure：断言或上下文类型把它变成不再是 env 类值的类型（as unknown、传给 unknown 形参等），之后就跟踪不到了。
//   作为实参传给 src 里的函数 / 构造器时，看的是声明里（未实例化）的形参类型：无约束类型参数（pick<T>(o: T)、
//   class Holder<T> { constructor(v: T) }），或约束是 unknown / object / Record<…> 这类不含 env 属性的宽类型，都算擦除——
//   推断后的实参类型虽然还是 env，函数体内按 T 处理，o[k] 之类的访问就看不到了。约束为 MailDbBinding / Bindings 的类型参数不算。
// - workers_env_import（范围是整个 src/，含 mail-source/ 与 env.ts）：`cloudflare:workers` 导出的模块级 env 是原始绑定，
//   不经入口的只读包装。禁止 import { env }（含 as 别名）、转导出 env 或 export *、动态 import 该模块；
//   import * as W / 默认导入后，W 只能以 W.<非 env 的名字> 出现（W.env、W[k]、把 W 整个交出去都报）。
//
// 两层防线：本守卫是静态的第一层；第二层是运行时只读包装（src/mail-source/readonly-db.ts，入口处把 env.MAIL_DB 换掉），
// 静态守卫漏掉的写法也只能执行 select 与 pragma table_info。
// 已知限制：类型已经是 any 的值不再跟踪；故意用 any 绕过类型系统的写法不在防线之内（代码评审兜底）；
// env 先放进别的对象或数组（{ e: c.env }、[c.env]）再交给泛型函数时只看外层对象，不往里追；
// 解析不到声明的调用（动态 import、eval 一类）按"src 之外"处理报 env_escape。这些由运行时包装兜底。

import path from "node:path";
import ts from "typescript";

const TOKEN = "MAIL_DB";

export type Violation = { file: string; line: number; rule: string; text: string };

type Ctx = { checker: ts.TypeChecker; srcDir: string; mailSourceDir: string; envFile: string };

const within = (file: string, dir: string): boolean => path.normalize(file).startsWith(dir);

/** 标识符或标识符链（a、a.b.c），不含调用、计算访问、this */
function isPlainChain(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return true;
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && isPlainChain(node.expression);
}

/** callee 是从 mail-source/ 导入的绑定（import { x } / import { x as y }），且最终声明位于 mail-source/ */
function isMailSourceImport(ctx: Ctx, callee: ts.Expression): boolean {
  if (!ts.isIdentifier(callee)) return false;
  const symbol = ctx.checker.getSymbolAtLocation(callee);
  const local = symbol?.declarations?.[0];
  if (!symbol || !local || !ts.isImportSpecifier(local) || (symbol.flags & ts.SymbolFlags.Alias) === 0) return false;
  const target = ctx.checker.getAliasedSymbol(symbol).declarations ?? [];
  return target.length > 0 && target.every((declaration) => within(declaration.getSourceFile().fileName, ctx.mailSourceDir));
}

function allowedMailDbAccess(ctx: Ctx, node: ts.PropertyAccessExpression): boolean {
  const call = node.parent;
  if (!isPlainChain(node.expression) || !ts.isCallExpression(call) || !call.arguments.includes(node)) return false;
  return isMailSourceImport(ctx, call.expression);
}

/** 属性声明在 env.ts 的 `type Bindings = { … }` 里 */
function declaredInBindings(ctx: Ctx, declaration: ts.Declaration): boolean {
  const literal = declaration.parent;
  const alias = literal?.parent;
  if (!literal || !ts.isTypeLiteralNode(literal) || !alias || !ts.isTypeAliasDeclaration(alias)) return false;
  return alias.name.text === "Bindings" && path.normalize(declaration.getSourceFile().fileName) === ctx.envFile;
}

function isEnvLikeType(ctx: Ctx, type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some((member) => isEnvLikeType(ctx, member));
  return ctx.checker
    .getPropertiesOfType(type)
    .some((prop) => prop.name === TOKEN || (prop.declarations ?? []).some((declaration) => declaredInBindings(ctx, declaration)));
}

function isEnvLike(ctx: Ctx, node: ts.Node): boolean {
  return isEnvLikeType(ctx, ctx.checker.getTypeAtLocation(node));
}

function isTokenString(node: ts.Node): boolean {
  return (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === TOKEN;
}

function tokenRule(ctx: Ctx, node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node) && node.name.text === TOKEN) return allowedMailDbAccess(ctx, node) ? null : "mail_db_access";
  if (ts.isIdentifier(node) && node.text === TOKEN) {
    // 属性访问里的名字由上一条判定
    return ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? null : "mail_db_name";
  }
  return isTokenString(node) ? "mail_db_string" : null;
}

function spreadRule(ctx: Ctx, node: ts.Node): string | null {
  if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && isEnvLike(ctx, node.expression)) return "env_spread";
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && isEnvLike(ctx, node.parent)) {
    const computedKey = node.propertyName !== undefined && ts.isComputedPropertyName(node.propertyName);
    if (node.dotDotDotToken !== undefined || computedKey) return "env_spread";
  }
  return null;
}

/** 调用解析到的声明不在 src/ 里（标准库、第三方库）或解析不到 */
function calleeOutsideSrc(ctx: Ctx, node: ts.CallExpression | ts.NewExpression): boolean {
  const declaration = ctx.checker.getResolvedSignature(node)?.getDeclaration();
  return declaration === undefined || !within(declaration.getSourceFile().fileName, ctx.srcDir);
}

function escapeRule(ctx: Ctx, node: ts.Node): string | null {
  if (ts.isElementAccessExpression(node) && isEnvLike(ctx, node.expression)) return "env_computed_access";
  if (ts.isForInStatement(node) && isEnvLike(ctx, node.expression)) return "env_escape";
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const args = node.arguments ?? [];
    if (args.some((arg) => isEnvLike(ctx, arg)) && calleeOutsideSrc(ctx, node)) return "env_escape";
  }
  return null;
}

function assertionErases(ctx: Ctx, node: ts.AsExpression | ts.TypeAssertion | ts.SatisfiesExpression): boolean {
  return isEnvLike(ctx, node.expression) && !isEnvLikeType(ctx, ctx.checker.getTypeFromTypeNode(node.type));
}

/** 去掉外层括号后是调用 / new 的实参（这类位置由 argumentRule 按声明的形参类型判定） */
function isCallArgument(node: ts.Node): boolean {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && (parent.arguments ?? []).some((arg) => arg === current);
}

/** 值表达式的上下文类型（带注解的变量、返回值等）不再是 env 类值 */
function contextErases(ctx: Ctx, node: ts.Expression): boolean {
  if (isCallArgument(node) || !isEnvLike(ctx, node)) return false;
  const contextual = ctx.checker.getContextualType(node);
  return contextual !== undefined && !isEnvLikeType(ctx, contextual);
}

/** 断言目标类型或上下文类型不再是 env 类值：之后的用法跟踪不到 */
function erasureRule(ctx: Ctx, node: ts.Node): string | null {
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    return assertionErases(ctx, node) ? "env_erasure" : null;
  }
  const valueLike = ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isParenthesizedExpression(node);
  return valueLike && contextErases(ctx, node) ? "env_erasure" : null;
}

/**
 * 第 index 个实参在声明里（未实例化）的形参类型；rest 形参取元素类型。
 * 实参多于形参（只能经 arguments 取到）时返回 null，按擦除处理。
 */
function isRestParameter(parameter: ts.Symbol): boolean {
  const declared = parameter.valueDeclaration;
  return declared !== undefined && ts.isParameter(declared) && declared.dotDotDotToken !== undefined;
}

function declaredParameterType(ctx: Ctx, declaration: ts.SignatureDeclaration, index: number): ts.Type | null {
  const parameters = ctx.checker.getSignatureFromDeclaration(declaration)?.parameters ?? [];
  const last = parameters.length - 1;
  const parameter = parameters[Math.min(index, last)];
  if (parameter === undefined) return null;
  const isRest = isRestParameter(parameter);
  if (index > last && !isRest) return null;
  const type = ctx.checker.getTypeOfSymbol(parameter);
  return isRest ? (ctx.checker.getIndexInfoOfType(type, ts.IndexKind.Number)?.type ?? type) : type;
}

/** env 类值作实参交给 src 里的函数 / 构造器，而声明的形参类型（含无约束或宽约束的类型参数）不是 env 类值 */
function argumentRule(ctx: Ctx, node: ts.Node): string | null {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return null;
  const args = node.arguments ?? [];
  if (!args.some((arg) => isEnvLike(ctx, arg))) return null;
  const declaration = ctx.checker.getResolvedSignature(node)?.getDeclaration();
  // src 之外或解析不到的由 escapeRule 报 env_escape
  if (declaration === undefined || !within(declaration.getSourceFile().fileName, ctx.srcDir)) return null;
  const erased = args.some((arg, index) => {
    if (!isEnvLike(ctx, arg)) return false;
    const declared = declaredParameterType(ctx, declaration, index);
    return declared === null || !isEnvLikeType(ctx, declared);
  });
  return erased ? "env_erasure" : null;
}

const WORKERS_MODULE = "cloudflare:workers";
const WORKERS_ENV = "env";

const isWorkersModule = (specifier: ts.Expression | undefined): boolean =>
  specifier !== undefined && ts.isStringLiteralLike(specifier) && specifier.text === WORKERS_MODULE;

/** import { env } / export { env } from "cloudflare:workers"（含 as 别名） */
function namesWorkersEnv(node: ts.ImportSpecifier | ts.ExportSpecifier): boolean {
  const declaration = ts.isImportSpecifier(node) ? node.parent.parent.parent : node.parent.parent;
  return isWorkersModule(declaration.moduleSpecifier) && (node.propertyName ?? node.name).text === WORKERS_ENV;
}

/** 标识符引用的是 `import * as W` 或默认导入自 cloudflare:workers 的本地名（不含声明处本身） */
function refersToWorkersNamespace(ctx: Ctx, node: ts.Identifier): boolean {
  const declaration = ctx.checker.getSymbolAtLocation(node)?.declarations?.[0];
  if (declaration === undefined) return false;
  if (ts.isNamespaceImport(declaration)) return declaration.name !== node && isWorkersModule(declaration.parent.parent.moduleSpecifier);
  if (ts.isImportClause(declaration)) return declaration.name !== node && isWorkersModule(declaration.parent.moduleSpecifier);
  return false;
}

/** W.<名字>（值或类型位置），且名字不是 env */
function namespaceMemberOtherThanEnv(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text !== WORKERS_ENV;
  if (ts.isQualifiedName(parent) && parent.left === node) return parent.right.text !== WORKERS_ENV;
  return false;
}

/** 转导出 env、export * 或动态 import cloudflare:workers */
function reexportsWorkers(node: ts.Node): boolean {
  if (ts.isExportDeclaration(node)) {
    const wholesale = node.exportClause === undefined || ts.isNamespaceExport(node.exportClause);
    return wholesale && isWorkersModule(node.moduleSpecifier);
  }
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && isWorkersModule(node.arguments[0]);
}

function workersEnvRule(ctx: Ctx, node: ts.Node): string | null {
  if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) return namesWorkersEnv(node) ? "workers_env_import" : null;
  if (reexportsWorkers(node)) return "workers_env_import";
  const leaked = ts.isIdentifier(node) && refersToWorkersNamespace(ctx, node) && !namespaceMemberOtherThanEnv(node);
  return leaked ? "workers_env_import" : null;
}

type Rule = (ctx: Ctx, node: ts.Node) => string | null;

const RULES: readonly Rule[] = [tokenRule, spreadRule, escapeRule, erasureRule, argumentRule, workersEnvRule];
/** mail-source/ 与 env.ts 只查 cloudflare:workers 的 env */
const RULES_EVERYWHERE: readonly Rule[] = [workersEnvRule];

function checkFile(ctx: Ctx, file: ts.SourceFile, rules: readonly Rule[]): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    for (const rule of rules) {
      const name = rule(ctx, node);
      if (name === null) continue;
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      violations.push({ file: path.relative(ctx.srcDir, file.fileName), line: line + 1, rule: name, text: node.getText(file).slice(0, 120) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

/** srcDir：被守卫的源码根目录（其下 mail-source/ 与 env.ts 只查 workers_env_import） */
export function findMailDbViolations(program: ts.Program, srcDir: string): Violation[] {
  const root = path.normalize(srcDir) + path.sep;
  const ctx: Ctx = {
    checker: program.getTypeChecker(),
    srcDir: root,
    mailSourceDir: path.join(root, "mail-source") + path.sep,
    envFile: path.join(root, "env.ts"),
  };
  const inSrc = (file: ts.SourceFile) => !file.isDeclarationFile && within(file.fileName, ctx.srcDir);
  const exempt = (file: ts.SourceFile) => within(file.fileName, ctx.mailSourceDir) || path.normalize(file.fileName) === ctx.envFile;
  return program
    .getSourceFiles()
    .filter(inSrc)
    .flatMap((file) => checkFile(ctx, file, exempt(file) ? RULES_EVERYWHERE : RULES));
}

/** 按 apps/worker/tsconfig.json 建 Program（与 typecheck 同一份配置） */
export function loadWorkerProgram(workerDir: string): ts.Program {
  const configPath = path.join(workerDir, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  } });
  if (!parsed) throw new Error(`读不到 ${configPath}`);
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}
