import { useState } from "react";
import { errorLine } from "../../lib/messages";
import { useToast } from "../../ui";

/** 复制到剪贴板：成功 toast，失败把原因留在 error 里由调用方就地显示（不假装成功） */
export function useCopy() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const copy = async (text: string, doneMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      toast.success(doneMessage);
    } catch (cause) {
      setError(errorLine(cause));
    }
  };
  return { copy, error };
}
