import { round2 } from './engine'
import type { CalcStep, ExcludedRule, PlanQuote, QuoteStatus } from './types'

/**
 * 规则方案对照引擎。
 *
 * 输入是同一输入快照在两套规则集下各自算出的 PlanQuote（纯函数结果），
 * 输出是逐步对齐后的差异结构。规则身份只看 ruleId：id 相同才视为同一规则，
 * 名称相同但 id 不同的规则不会被猜测为等价（一个记移除、一个记新增）。
 */

export type ModificationField = 'priority' | 'scope' | 'detail' | 'name'

export interface Modification {
  field: ModificationField
  before: string
  after: string
}

/** 一条对齐后的规则节点。a = 基线侧，b = 对照侧。 */
export type StepMatch =
  | { type: 'unchanged'; a: CalcStep; b: CalcStep }
  /** 规则本身未变，但金额被上游变化连锁改变（影响传播） */
  | { type: 'propagated'; a: CalcStep; b: CalcStep; causedBy: string | null }
  | { type: 'modified'; a: CalcStep; b: CalcStep; aspects: Modification[] }
  | { type: 'added'; b: CalcStep }
  | { type: 'removed'; a: CalcStep }

export interface AlignedStep {
  /** 对齐键 = 规则 ID */
  key: string
  match: StepMatch
}

export type ExcludedMatch =
  | { type: 'both'; a: ExcludedRule; b: ExcludedRule; reasonChanged: boolean }
  | { type: 'onlyBase'; a: ExcludedRule; otherSide: 'hit' | 'absent' }
  | { type: 'onlyCompare'; b: ExcludedRule; otherSide: 'hit' | 'absent' }

export interface CompareStats {
  added: number
  removed: number
  modified: number
  propagated: number
  unchanged: number
}

export interface QuoteComparison {
  planId: string
  statusBase: QuoteStatus
  statusCompare: QuoteStatus
  totalBase: number | null
  totalCompare: number | null
  totalDelta: number | null
  /** 按对照侧执行顺序为主轴逐步对齐的规则节点 */
  steps: AlignedStep[]
  /** 未生效规则（互斥取舍、不在适用范围）的两侧对照 */
  excluded: ExcludedMatch[]
  /** 仅对照方案出现的提示 */
  messagesAdded: string[]
  /** 仅基线出现的提示 */
  messagesRemoved: string[]
  /** 第一个非“一致”节点的下标；全部一致时为 null */
  firstDivergence: number | null
  stats: CompareStats
}

/** 规则配置指纹：同一输入快照下，这些字段一致即视为“规则本身未变”。 */
function classifyPair(a: CalcStep, b: CalcStep): StepMatch {
  const aspects: Modification[] = []
  if (a.priority !== b.priority) {
    aspects.push({ field: 'priority', before: String(a.priority), after: String(b.priority) })
  }
  if (a.scopeText !== b.scopeText) {
    aspects.push({ field: 'scope', before: a.scopeText, after: b.scopeText })
  }
  if (a.detail !== b.detail) {
    aspects.push({ field: 'detail', before: a.detail, after: b.detail })
  }
  if (a.ruleName !== b.ruleName) {
    aspects.push({ field: 'name', before: a.ruleName, after: b.ruleName })
  }
  if (aspects.length > 0) return { type: 'modified', a, b, aspects }
  if (a.amountBefore !== b.amountBefore || a.amountAfter !== b.amountAfter) {
    return { type: 'propagated', a, b, causedBy: null }
  }
  return { type: 'unchanged', a, b }
}

/**
 * 逐步对齐两条规则链：以对照侧执行顺序为主轴，基线侧独有的节点
 * 插入到它在基线链中最近前驱的后面，保证两侧顺序都尽量可读。
 */
export function alignSteps(baseSteps: CalcStep[], compareSteps: CalcStep[]): AlignedStep[] {
  const baseById = new Map(baseSteps.map((s) => [s.ruleId, s]))
  const compareById = new Map(compareSteps.map((s) => [s.ruleId, s]))

  const aligned: AlignedStep[] = compareSteps.map((b) => {
    const a = baseById.get(b.ruleId)
    return a
      ? { key: b.ruleId, match: classifyPair(a, b) }
      : { key: b.ruleId, match: { type: 'added', b } }
  })

  const positionOf = new Map(aligned.map((s, i) => [s.key, i]))
  for (const a of baseSteps) {
    if (compareById.has(a.ruleId)) continue
    let insertAt = 0
    for (let j = baseSteps.indexOf(a) - 1; j >= 0; j--) {
      const prevPos = positionOf.get(baseSteps[j].ruleId)
      if (prevPos !== undefined) {
        insertAt = prevPos + 1
        break
      }
    }
    aligned.splice(insertAt, 0, { key: a.ruleId, match: { type: 'removed', a } })
    positionOf.clear()
    aligned.forEach((s, i) => positionOf.set(s.key, i))
  }

  // 影响传播归因：规则未变但金额变化的节点，归因到它之前最近的直接变更
  let lastDirectChange: string | null = null
  for (const step of aligned) {
    switch (step.match.type) {
      case 'added':
      case 'removed':
      case 'modified':
        lastDirectChange = step.key
        break
      case 'propagated':
        step.match.causedBy = lastDirectChange
        break
    }
  }
  return aligned
}

function alignExcluded(base: PlanQuote, compare: PlanQuote): ExcludedMatch[] {
  const result: ExcludedMatch[] = []
  const compareExcludedById = new Map(compare.excluded.map((e) => [e.ruleId, e]))
  const baseExcludedIds = new Set(base.excluded.map((e) => e.ruleId))
  const compareHitIds = new Set(compare.steps.map((s) => s.ruleId))
  const baseHitIds = new Set(base.steps.map((s) => s.ruleId))

  for (const a of base.excluded) {
    const b = compareExcludedById.get(a.ruleId)
    if (b) {
      result.push({ type: 'both', a, b, reasonChanged: a.reason !== b.reason })
    } else {
      result.push({ type: 'onlyBase', a, otherSide: compareHitIds.has(a.ruleId) ? 'hit' : 'absent' })
    }
  }
  for (const b of compare.excluded) {
    if (!baseExcludedIds.has(b.ruleId)) {
      result.push({ type: 'onlyCompare', b, otherSide: baseHitIds.has(b.ruleId) ? 'hit' : 'absent' })
    }
  }
  return result
}

/** 对照两份报价（同一输入快照、同一方案、不同规则集的计算结果）。 */
export function compareQuotes(base: PlanQuote, compare: PlanQuote): QuoteComparison {
  const bothOk = base.status === 'ok' && compare.status === 'ok'
  const steps = bothOk ? alignSteps(base.steps, compare.steps) : []

  const stats: CompareStats = { added: 0, removed: 0, modified: 0, propagated: 0, unchanged: 0 }
  for (const s of steps) stats[s.match.type]++

  const first = steps.findIndex((s) => s.match.type !== 'unchanged')

  return {
    planId: base.planId,
    statusBase: base.status,
    statusCompare: compare.status,
    totalBase: base.status === 'ok' ? base.total : null,
    totalCompare: compare.status === 'ok' ? compare.total : null,
    totalDelta: bothOk ? round2(compare.total - base.total) : null,
    steps,
    excluded: alignExcluded(base, compare),
    messagesAdded: compare.messages.filter((m) => !base.messages.includes(m)),
    messagesRemoved: base.messages.filter((m) => !compare.messages.includes(m)),
    firstDivergence: first === -1 ? null : first,
    stats,
  }
}

/**
 * 重放到对齐序列的某个节点时，两侧各自的累计保费。
 * 每侧取到该节点为止最后一条已生效规则的 amountAfter。
 */
export function replayTotals(steps: AlignedStep[], cursor: number): { base: number; compare: number } {
  let base = 0
  let compare = 0
  const end = Math.min(cursor, steps.length - 1)
  for (let i = 0; i <= end; i++) {
    const m = steps[i].match
    switch (m.type) {
      case 'unchanged':
      case 'propagated':
      case 'modified':
        base = m.a.amountAfter
        compare = m.b.amountAfter
        break
      case 'removed':
        base = m.a.amountAfter
        break
      case 'added':
        compare = m.b.amountAfter
        break
    }
  }
  return { base, compare }
}
