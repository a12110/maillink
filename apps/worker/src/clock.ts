/** 当前 Unix 秒（库里所有时间列都用 Unix 秒，见 01 §5） */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
