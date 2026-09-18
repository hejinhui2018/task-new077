export const fmtMoney = (n: number): string =>
  `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const fmtWan = (n: number): string => `${n / 10000} 万`

/** 带符号的差额，如 +¥12.00 / -¥5.00 */
export const fmtDelta = (n: number): string => `${n > 0 ? '+' : n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
