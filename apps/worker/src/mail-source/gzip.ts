/** D1 返回的 BLOB 是 Array<number>（也兼容 ArrayBuffer / Uint8Array） */
export type D1Blob = ArrayLike<number> | ArrayBuffer | null | undefined;

export function blobToBytes(blob: D1Blob): Uint8Array {
  if (!blob) return new Uint8Array(0);
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  return Uint8Array.from(blob);
}

/** gzip 解压为 UTF-8 文本；数据损坏时抛出，不回退 */
export async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
