const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([\w.]+)/;

/** 若错误是唯一约束冲突，返回冲突的 `表.列`（如 `users.username_lc`），否则 null */
export function uniqueViolationTarget(error: unknown): string | null {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return UNIQUE_VIOLATION_PATTERN.exec(message)?.[1] ?? null;
}
