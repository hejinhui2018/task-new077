import type { QuoteComparison } from '../engine/compare'
import type { QuoteInput } from '../engine/types'
import { isQuoteInput, sameInput } from './history'

/** 保存的一次比较快照：包含完整对照结果，载入时无需重算即可查看。 */
export interface CompareSnapshot {
  id: string
  label: string
  createdAt: number
  /** 拍摄时使用的输入快照 */
  input: QuoteInput
  baseSetId: string
  compareSetId: string
  /** 拍摄时 A 是否为基线（载入时据此还原方向） */
  baseFirst: boolean
  planId: string
  result: QuoteComparison
}

export interface CompareState {
  /** 锁定的输入快照；null 表示跟随实时输入 */
  lockedInput: QuoteInput | null
  /** true：A 为基线、B 为对照；false：交换 */
  baseFirst: boolean
  snapshots: CompareSnapshot[]
  /** 正在重放的差异节点（按对齐键定位，游标由组件从当前结果推导） */
  replay: { key: string } | null
}

export interface CompareHistory {
  past: CompareState[]
  present: CompareState
  future: CompareState[]
}

export type CompareAction =
  | { type: 'toggleLock'; currentInput?: QuoteInput }
  | { type: 'swapBaseline' }
  | { type: 'saveSnapshot'; snapshot: CompareSnapshot }
  | { type: 'deleteSnapshot'; id: string }
  | { type: 'loadSnapshot'; id: string }
  | { type: 'replayTo'; key: string }
  | { type: 'replayMove'; delta: 1 | -1; keys: string[] }
  | { type: 'replayClose' }
  | { type: 'undo' }
  | { type: 'redo' }

const LIMIT = 50

export const initialCompareState: CompareState = {
  lockedInput: null,
  baseFirst: true,
  snapshots: [],
  replay: null,
}

export function initCompareHistory(): CompareHistory {
  return { past: [], present: initialCompareState, future: [] }
}

const cloneInput = (input: QuoteInput): QuoteInput => ({ ...input, riderIds: [...input.riderIds] })

/** 推入新状态（可撤销）；重放游标移动不进历史。 */
const push = (h: CompareHistory, next: CompareState): CompareHistory => ({
  past: [...h.past, h.present].slice(-LIMIT),
  present: next,
  future: [],
})

const inplace = (h: CompareHistory, next: CompareState): CompareHistory => ({ ...h, present: next })

/** 同一输入、同一方向、同一方案的重复比较不重复保存。 */
function isDuplicateSnapshot(snapshots: CompareSnapshot[], snap: CompareSnapshot): boolean {
  return snapshots.some(
    (s) =>
      s.planId === snap.planId &&
      s.baseSetId === snap.baseSetId &&
      s.compareSetId === snap.compareSetId &&
      sameInput(s.input, snap.input),
  )
}

export function compareHistoryReducer(h: CompareHistory, action: CompareAction): CompareHistory {
  switch (action.type) {
    case 'toggleLock': {
      // 解锁不需要 currentInput；锁定时必须提供当前输入
      if (h.present.lockedInput === null) {
        if (!action.currentInput) return h
        return push(h, { ...h.present, lockedInput: cloneInput(action.currentInput), replay: null })
      }
      return push(h, { ...h.present, lockedInput: null, replay: null })
    }
    case 'swapBaseline':
      return push(h, { ...h.present, baseFirst: !h.present.baseFirst, replay: null })
    case 'saveSnapshot': {
      if (isDuplicateSnapshot(h.present.snapshots, action.snapshot)) return h
      return push(h, { ...h.present, snapshots: [...h.present.snapshots, action.snapshot] })
    }
    case 'deleteSnapshot': {
      if (!h.present.snapshots.some((s) => s.id === action.id)) return h
      return push(h, { ...h.present, snapshots: h.present.snapshots.filter((s) => s.id !== action.id) })
    }
    case 'loadSnapshot': {
      const snap = h.present.snapshots.find((s) => s.id === action.id)
      if (!snap) return h
      return push(h, {
        ...h.present,
        lockedInput: cloneInput(snap.input),
        baseFirst: snap.baseFirst,
        replay: null,
      })
    }
    case 'replayTo':
      return inplace(h, { ...h.present, replay: { key: action.key } })
    case 'replayMove': {
      if (!h.present.replay || action.keys.length === 0) return h
      const idx = action.keys.indexOf(h.present.replay.key)
      if (idx === -1) return h
      const next = Math.min(Math.max(idx + action.delta, 0), action.keys.length - 1)
      return inplace(h, { ...h.present, replay: { key: action.keys[next] } })
    }
    case 'replayClose':
      if (!h.present.replay) return h
      return inplace(h, { ...h.present, replay: null })
    case 'undo': {
      if (h.past.length === 0) return h
      return {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
      }
    }
    case 'redo': {
      if (h.future.length === 0) return h
      const [next, ...rest] = h.future
      return { past: [...h.past, h.present], present: next, future: rest }
    }
    default:
      return h
  }
}

/* ================= 刷新恢复 ================= */

function isReplay(v: unknown): v is { key: string } | null {
  if (v === null) return true
  if (typeof v !== 'object' || v === null) return false
  return typeof (v as Record<string, unknown>).key === 'string'
}

function isSnapshot(v: unknown): v is CompareSnapshot {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.createdAt === 'number' &&
    isQuoteInput(o.input) &&
    typeof o.baseSetId === 'string' &&
    typeof o.compareSetId === 'string' &&
    typeof o.baseFirst === 'boolean' &&
    typeof o.planId === 'string' &&
    typeof o.result === 'object' &&
    o.result !== null
  )
}

function isCompareState(v: unknown): v is CompareState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    (o.lockedInput === null || isQuoteInput(o.lockedInput)) &&
    typeof o.baseFirst === 'boolean' &&
    Array.isArray(o.snapshots) &&
    o.snapshots.every(isSnapshot) &&
    isReplay(o.replay)
  )
}

/** 从持久化的 JSON 恢复对照历史（含快照与撤销栈）；结构不合法时返回 null。 */
export function restoreCompareHistory(v: unknown): CompareHistory | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.past) || !Array.isArray(o.future) || !isCompareState(o.present)) return null
  return {
    past: o.past.filter(isCompareState),
    present: o.present,
    future: o.future.filter(isCompareState),
  }
}
