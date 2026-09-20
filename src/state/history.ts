import { DEFAULT_RULESET_A, DEFAULT_RULESET_B, cloneRuleset, type RuleSet } from '../engine/ruleset'
import { DEFAULT_INPUT } from '../engine/data'
import type { QuoteInput } from '../engine/types'

/** 对照双方：a 为基线侧，b 为候选侧。 */
export interface RuleSetPair {
  a: RuleSet
  b: RuleSet
}

/** 一次可撤销操作所对应的完整工作区快照。 */
export interface WorkspaceState {
  input: QuoteInput
  ruleSets: RuleSetPair
}

export interface HistoryState {
  past: WorkspaceState[]
  present: WorkspaceState
  future: WorkspaceState[]
}

export type HistoryAction =
  | { type: 'updateInput'; next: QuoteInput }
  | { type: 'updateRuleSet'; side: 'a' | 'b'; next: RuleSet }
  | { type: 'swapRuleSets' }
  | { type: 'replace'; next: WorkspaceState }
  | { type: 'reset'; initial: WorkspaceState }
  | { type: 'undo' }
  | { type: 'redo' }

const LIMIT = 50

export function defaultWorkspace(): WorkspaceState {
  return {
    input: DEFAULT_INPUT,
    ruleSets: { a: cloneRuleset(DEFAULT_RULESET_A), b: cloneRuleset(DEFAULT_RULESET_B) },
  }
}

export function initHistory(initial: WorkspaceState): HistoryState {
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

export function sameRuleSet(a: RuleSet, b: RuleSet): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export function sameWorkspace(a: WorkspaceState, b: WorkspaceState): boolean {
  return sameInput(a.input, b.input) && sameRuleSet(a.ruleSets.a, b.ruleSets.a) && sameRuleSet(a.ruleSets.b, b.ruleSets.b)
}

function push(state: HistoryState, next: WorkspaceState): HistoryState {
  if (sameWorkspace(state.present, next)) return state
  return {
    past: [...state.past, state.present].slice(-LIMIT),
    present: next,
    future: [],
  }
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'updateInput':
      return push(state, { ...state.present, input: action.next })
    case 'updateRuleSet':
      return push(state, {
        ...state.present,
        ruleSets: { ...state.present.ruleSets, [action.side]: action.next },
      })
    case 'swapRuleSets':
      return push(state, {
        ...state.present,
        ruleSets: { a: state.present.ruleSets.b, b: state.present.ruleSets.a },
      })
    case 'replace':
      return push(state, action.next)
    case 'reset':
      return push(state, action.initial)
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
  }
}
