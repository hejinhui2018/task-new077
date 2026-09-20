/** localStorage 读写的安全封装：隐私模式 / 超限 / 非浏览器环境下静默降级。 */

export function loadJSON<T>(key: string, revive: (value: unknown) => T | null): T | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return revive(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储不可用（隐私模式、配额满）时忽略，功能本身不受影响
  }
}
