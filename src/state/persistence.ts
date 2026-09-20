import type { HistoryState, WorkspaceState } from './history'

/** 一次保存的规则对照快照。 */
export interface CompareSnapshot {
  id: string
  name: string
  /** ISO 时间串 */
  createdAt: string
  state: WorkspaceState
  selectedPlanId: string
}

export interface PersistedWorkspace {
  version: 1
  history: HistoryState
  mode: 'calc' | 'compare'
  selectedPlanId: string
  inputLocked: boolean
  snapshots: CompareSnapshot[]
}

export const STORAGE_KEY = 'policylens.workspace.v1'

export function serializeWorkspace(p: PersistedWorkspace): string {
  return JSON.stringify(p)
}

/** 解析持久化内容；任何结构不符都返回 null（调用方回退到默认工作区）。 */
export function parseWorkspace(json: string | null): PersistedWorkspace | null {
  if (!json) return null
  try {
    const raw: unknown = JSON.parse(json)
    if (typeof raw !== 'object' || raw === null) return null
    const p = raw as Partial<PersistedWorkspace>
    if (p.version !== 1) return null
    const h = p.history
    if (!h || !Array.isArray(h.past) || !Array.isArray(h.future) || !h.present) return null
    if (!h.present.input || !h.present.ruleSets?.a || !h.present.ruleSets?.b) return null
    return {
      version: 1,
      history: h,
      mode: p.mode === 'compare' ? 'compare' : 'calc',
      selectedPlanId: typeof p.selectedPlanId === 'string' ? p.selectedPlanId : 'standard',
      inputLocked: p.inputLocked === true,
      snapshots: Array.isArray(p.snapshots) ? (p.snapshots as CompareSnapshot[]) : [],
    }
  } catch {
    return null
  }
}

export function loadWorkspace(): PersistedWorkspace | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return parseWorkspace(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function saveWorkspace(p: PersistedWorkspace): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(STORAGE_KEY, serializeWorkspace(p))
  } catch {
    // 隐私模式 / 配额不足时静默失败，不影响使用
  }
}
