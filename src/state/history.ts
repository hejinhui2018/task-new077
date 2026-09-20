import type { QuoteInput } from '../engine/types'

export interface HistoryState {
  past: QuoteInput[]
  present: QuoteInput
  future: QuoteInput[]
}

export type HistoryAction =
  | { type: 'update'; next: QuoteInput }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; initial: QuoteInput }

const LIMIT = 50

export function initHistory(initial: QuoteInput): HistoryState {
  return { past: [], present: initial, future: [] }
}

export function sameInput(a: QuoteInput, b: QuoteInput): boolean {
  return (
    a.age === b.age &&
    a.regionId === b.regionId &&
    a.sumInsured === b.sumInsured &&
    a.riderIds.length === b.riderIds.length &&
    a.riderIds.every((id) => b.riderIds.includes(id))
  )
}

/** 校验一个未知值是否是合法的 QuoteInput（用于刷新后从 localStorage 恢复）。 */
export function isQuoteInput(v: unknown): v is QuoteInput {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const numOrNull = (x: unknown) => typeof x === 'number' || x === null
  return (
    numOrNull(o.age) &&
    (typeof o.regionId === 'string' || o.regionId === null) &&
    numOrNull(o.sumInsured) &&
    Array.isArray(o.riderIds) &&
    o.riderIds.every((x) => typeof x === 'string')
  )
}

/** 从持久化的 JSON 恢复输入历史；结构不合法时返回 null（回退到默认输入）。 */
export function restoreHistory(v: unknown): HistoryState | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.past) || !Array.isArray(o.future) || !isQuoteInput(o.present)) return null
  return {
    past: o.past.filter(isQuoteInput),
    present: o.present,
    future: o.future.filter(isQuoteInput),
  }
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'update': {
      if (sameInput(state.present, action.next)) return state
      return {
        past: [...state.past, state.present].slice(-LIMIT),
        present: action.next,
        future: [],
      }
    }
    case 'undo': {
      if (state.past.length === 0) return state
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const [next, ...rest] = state.future
      return { past: [...state.past, state.present], present: next, future: rest }
    }
    case 'reset': {
      if (sameInput(state.present, action.initial)) return state
      return {
        past: [...state.past, state.present].slice(-LIMIT),
        present: action.initial,
        future: [],
      }
    }
  }
}
