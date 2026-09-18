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
