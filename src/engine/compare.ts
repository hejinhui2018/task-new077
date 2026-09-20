import type { AgeBand, Discount, Plan, Region, Rider } from './data'
import { round2 } from './engine'
import type { RuleSet } from './ruleset'
import type { CalcStep, PlanQuote, RuleKind, RuleRef } from './types'

/* =====================================================================================
 * 规则实体：把方案 / 年龄段 / 地区 / 折扣 / 附加险统一成可比较的结构。
 *
 * 匹配原则（重要）：
 *  - 只按“结构指纹”与“稳定 id”匹配，绝不按名称猜测。
 *  - 指纹 = 规则类型 + 全部语义参数（适用范围 + 计算参数），不含名称、描述、优先级。
 *  - 方案与地区的 id 是引用数据（输入快照按 id 引用它们），因此 id 计入指纹；
 *    年龄段 / 折扣 / 附加险的 id 只是集合内标识，语义由参数决定，不计入指纹。
 * =================================================================================== */

export interface RuleField {
  key: string
  label: string
  value: string
}

export interface RuleEntity {
  /** `${kind}:${id}`，规则集内唯一 */
  key: string
  kind: RuleKind
  id: string
  /** 展示名称，绝不参与匹配 */
  name: string
  /** 参与互斥取舍 / 叠加顺序的优先级；基础、年龄、地区为引擎固定值 */
  priority: number
  fingerprint: string
  /** 语义参数列表，用于参数变化时逐字段展示 */
  fields: RuleField[]
}

export interface FieldChange {
  label: string
  before: string
  after: string
}

export interface RulePair {
  before: RuleEntity
  after: RuleEntity
  /** 逐字段差异（优先级差异也在其中），仅用于展示 */
  changes: FieldChange[]
}

export interface RuleSetDiff {
  /** 仅存在于 B（候选侧） */
  added: RuleEntity[]
  /** 仅存在于 A（基线侧） */
  removed: RuleEntity[]
  /** 同一稳定 id、但结构参数不同 */
  modified: RulePair[]
  /** 结构完全一致、仅优先级不同 */
  priorityChanged: RulePair[]
  /** 结构完全一致（名称可能不同，名称差异附在 changes 里展示） */
  unchanged: RulePair[]
  /** A 侧实体 key → B 侧实体 key，用于对齐两条计算轨迹 */
  matchedMap: Map<string, string>
}

const KIND_LABEL: Record<RuleKind, string> = {
  base: '基础保费',
  age: '年龄费率',
  region: '地区系数',
  discount: '折扣',
  rider: '附加险',
}

export const entityKindLabel = (kind: RuleKind): string => KIND_LABEL[kind]

export const entityKeyOf = (ref: RuleRef): string => `${ref.kind}:${ref.id}`

const fmtFeeType = (t: Rider['feeType']): string => (t === 'per10W' ? '按每 10 万保额' : '定额年费')

function planEntity(p: Plan): RuleEntity {
  return {
    key: `base:${p.id}`,
    kind: 'base',
    id: p.id,
    name: `基础保费（${p.name}）`,
    priority: 100,
    fingerprint: `base|${p.id}|${p.baseRatePer10W}`,
    fields: [{ key: 'rate', label: '每 10 万保费', value: `${p.baseRatePer10W} 元` }],
  }
}

function ageBandEntity(b: AgeBand): RuleEntity {
  return {
    key: `age:${b.id}`,
    kind: 'age',
    id: b.id,
    name: b.label,
    priority: 90,
    fingerprint: `age|${b.min}|${b.max}|${b.factor}`,
    fields: [
      { key: 'min', label: '年龄下限', value: `${b.min} 岁` },
      { key: 'max', label: '年龄上限', value: `${b.max} 岁` },
      { key: 'factor', label: '费率系数', value: `×${b.factor}` },
    ],
  }
}

function regionEntity(r: Region): RuleEntity {
  return {
    key: `region:${r.id}`,
    kind: 'region',
    id: r.id,
    name: `地区系数（${r.name}）`,
    priority: 80,
    fingerprint: `region|${r.id}|${r.factor}`,
    fields: [{ key: 'factor', label: '地区系数', value: `×${r.factor}` }],
  }
}

function discountEntity(d: Discount): RuleEntity {
  const c = d.condition
  const condFields: RuleField[] =
    c.type === 'sumInsuredAtLeast'
      ? [{ key: 'value', label: '保额门槛', value: `${c.value / 10000} 万` }]
      : [
          { key: 'min', label: '年龄下限', value: `${c.min} 岁` },
          { key: 'max', label: '年龄上限', value: `${c.max} 岁` },
        ]
  const condKey = c.type === 'sumInsuredAtLeast' ? `sum>=${c.value}` : `age:${c.min}-${c.max}`
  return {
    key: `discount:${d.id}`,
    kind: 'discount',
    id: d.id,
    name: d.name,
    priority: d.priority,
    fingerprint: `discount|${condKey}|${d.factor}`,
    fields: [
      { key: 'conditionType', label: '条件类型', value: c.type === 'sumInsuredAtLeast' ? '保额门槛' : '年龄区间' },
      ...condFields,
      { key: 'factor', label: '折扣系数', value: `×${d.factor}` },
    ],
  }
}

function riderEntity(r: Rider, ruleset: RuleSet): RuleEntity {
  const conflicts = [...r.conflictsWith].sort()
  const conflictNames = conflicts
    .map((id) => ruleset.riders.find((x) => x.id === id)?.name ?? id)
    .join('、')
  const opt = (v: number | undefined): string => (v === undefined ? '不限' : String(v))
  return {
    key: `rider:${r.id}`,
    kind: 'rider',
    id: r.id,
    name: r.name,
    priority: r.priority,
    fingerprint: `rider|${r.feeType}|${r.fee}|${opt(r.minAge)}|${opt(r.maxAge)}|${opt(r.minSumInsured)}|${conflicts.join(',')}`,
    fields: [
      { key: 'feeType', label: '计费方式', value: fmtFeeType(r.feeType) },
      { key: 'fee', label: '费率', value: r.feeType === 'per10W' ? `${r.fee} 元 / 10 万` : `${r.fee} 元 / 年` },
      { key: 'minAge', label: '适用年龄下限', value: r.minAge === undefined ? '不限' : `${r.minAge} 岁` },
      { key: 'maxAge', label: '适用年龄上限', value: r.maxAge === undefined ? '不限' : `${r.maxAge} 岁` },
      {
        key: 'minSumInsured',
        label: '最低保额',
        value: r.minSumInsured === undefined ? '不限' : `${r.minSumInsured / 10000} 万`,
      },
      { key: 'conflicts', label: '互斥', value: conflictNames || '无' },
    ],
  }
}

/** 把规则集展开成统一实体列表（顺序固定：基础 → 年龄 → 地区 → 折扣 → 附加险）。 */
export function extractRules(ruleset: RuleSet): RuleEntity[] {
  return [
    ...ruleset.plans.map(planEntity),
    ...ruleset.ageBands.map(ageBandEntity),
    ...ruleset.regions.map(regionEntity),
    ...ruleset.discounts.map(discountEntity),
    ...ruleset.riders.map((r) => riderEntity(r, ruleset)),
  ]
}

function makePair(before: RuleEntity, after: RuleEntity): RulePair {
  const changes: FieldChange[] = []
  if (before.priority !== after.priority) {
    changes.push({ label: '优先级', before: String(before.priority), after: String(after.priority) })
  }
  for (const f of before.fields) {
    const other = after.fields.find((x) => x.key === f.key)
    if (other && other.value !== f.value) {
      changes.push({ label: f.label, before: f.value, after: other.value })
    }
  }
  // 名称不参与匹配，但若两侧名称不同，附在末尾提示
  if (before.name !== after.name) {
    changes.push({ label: '名称', before: before.name, after: after.name })
  }
  return { before, after, changes }
}

/**
 * 逐层匹配两套规则集的等价规则：
 *  1. 结构指纹完全一致 → 等价（优先级不同则记为“优先级变化”）；
 *  2. 剩余规则按稳定 id 配对（同类型且 id 在两侧各自唯一）→ “参数变化”；
 *  3. 仍无法匹配的 → 新增 / 移除，绝不按名称猜测。
 */
export function diffRuleSets(a: RuleSet, b: RuleSet): RuleSetDiff {
  const entitiesA = extractRules(a)
  const entitiesB = extractRules(b)

  const matchedMap = new Map<string, string>()
  const unchanged: RulePair[] = []
  const priorityChanged: RulePair[] = []
  const modified: RulePair[] = []
  const consumedB = new Set<string>()

  // 1. 结构指纹多重集配对（B 侧同指纹按 key 排序，保证结果确定）
  const poolByFingerprint = new Map<string, RuleEntity[]>()
  for (const e of entitiesB) {
    const pool = poolByFingerprint.get(e.fingerprint) ?? []
    pool.push(e)
    poolByFingerprint.set(e.fingerprint, pool)
  }
  for (const pool of poolByFingerprint.values()) {
    pool.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
  }

  const unmatchedA: RuleEntity[] = []
  for (const ea of entitiesA) {
    const pool = poolByFingerprint.get(ea.fingerprint)
    const eb = pool?.find((e) => !consumedB.has(e.key))
    if (eb) {
      consumedB.add(eb.key)
      matchedMap.set(ea.key, eb.key)
      const pair = makePair(ea, eb)
      if (ea.priority !== eb.priority) priorityChanged.push(pair)
      else unchanged.push(pair)
    } else {
      unmatchedA.push(ea)
    }
  }

  // 2. 剩余按稳定 id 配对：同类型、id 相同，且在两侧未匹配集合中各自唯一
  const unmatchedB = entitiesB.filter((e) => !consumedB.has(e.key))
  const removed: RuleEntity[] = []
  for (const ea of unmatchedA) {
    const sameIdA = unmatchedA.filter((e) => e.kind === ea.kind && e.id === ea.id)
    const sameIdB = unmatchedB.filter((e) => e.kind === ea.kind && e.id === ea.id && !consumedB.has(e.key))
    if (sameIdA.length === 1 && sameIdB.length === 1) {
      const eb = sameIdB[0]
      consumedB.add(eb.key)
      matchedMap.set(ea.key, eb.key)
      modified.push(makePair(ea, eb))
    } else {
      removed.push(ea)
    }
  }
  const added = unmatchedB.filter((e) => !consumedB.has(e.key))

  return { added, removed, modified, priorityChanged, unchanged, matchedMap }
}

/* ============================== 影响传播 ============================== */

export type RowStatus = 'unchanged' | 'priority-changed' | 'modified' | 'added' | 'removed'

export interface PropagationRow {
  key: string
  a: CalcStep | null
  b: CalcStep | null
  /** 在各自计算轨迹中的序号（0 起）；未命中 / 不存在的一侧为 null */
  aIndex: number | null
  bIndex: number | null
  status: RowStatus
}

const PHASE_ORDER: Record<RuleKind, number> = { base: 0, age: 1, region: 2, discount: 3, rider: 4 }

/**
 * 对齐同一输入快照在两套规则集下的计算轨迹：
 * 命中关系沿规则匹配结果（matchedMap）对齐，而不是按步骤位置或规则名称。
 */
export function buildPropagation(quoteA: PlanQuote, quoteB: PlanQuote, diff: RuleSetDiff): PropagationRow[] {
  const statusByKeyA = new Map<string, RowStatus>()
  const statusByKeyB = new Map<string, RowStatus>()
  for (const p of diff.unchanged) {
    statusByKeyA.set(p.before.key, 'unchanged')
    statusByKeyB.set(p.after.key, 'unchanged')
  }
  for (const p of diff.priorityChanged) {
    statusByKeyA.set(p.before.key, 'priority-changed')
    statusByKeyB.set(p.after.key, 'priority-changed')
  }
  for (const p of diff.modified) {
    statusByKeyA.set(p.before.key, 'modified')
    statusByKeyB.set(p.after.key, 'modified')
  }
  for (const e of diff.removed) statusByKeyA.set(e.key, 'removed')
  for (const e of diff.added) statusByKeyB.set(e.key, 'added')

  const rows: PropagationRow[] = []
  const usedB = new Set<number>()

  quoteA.steps.forEach((sa, i) => {
    const keyA = entityKeyOf(sa.ruleRef)
    const keyB = diff.matchedMap.get(keyA)
    const j = keyB
      ? quoteB.steps.findIndex((s, idx) => !usedB.has(idx) && entityKeyOf(s.ruleRef) === keyB)
      : -1
    if (j >= 0) {
      usedB.add(j)
      rows.push({ key: `pair-${i}`, a: sa, b: quoteB.steps[j], aIndex: i, bIndex: j, status: statusByKeyA.get(keyA) ?? 'unchanged' })
    } else {
      rows.push({ key: `only-a-${i}`, a: sa, b: null, aIndex: i, bIndex: null, status: statusByKeyA.get(keyA) ?? 'unchanged' })
    }
  })

  quoteB.steps.forEach((sb, j) => {
    if (usedB.has(j)) return
    const keyB = entityKeyOf(sb.ruleRef)
    rows.push({ key: `only-b-${j}`, a: null, b: sb, aIndex: null, bIndex: j, status: statusByKeyB.get(keyB) ?? 'added' })
  })

  rows.sort((r1, r2) => {
    const k1 = (r1.a ?? r1.b)!.kind
    const k2 = (r2.a ?? r2.b)!.kind
    if (PHASE_ORDER[k1] !== PHASE_ORDER[k2]) return PHASE_ORDER[k1] - PHASE_ORDER[k2]
    return (r1.aIndex ?? r1.bIndex ?? 0) - (r2.aIndex ?? r2.bIndex ?? 0)
  })
  return rows
}

/** 重放 / 渲染共用：前 count 行之后，两侧各自的累计金额。 */
export function replayTotals(rows: PropagationRow[], count: number): { a: number; b: number } {
  let a = 0
  let b = 0
  const n = Math.min(count, rows.length)
  for (let i = 0; i < n; i += 1) {
    if (rows[i].a) a = rows[i].a!.amountAfter
    if (rows[i].b) b = rows[i].b!.amountAfter
  }
  return { a, b }
}

/* ============================== 差异解释 ============================== */

function findRowByEntity(rows: PropagationRow[], entityKey: string, side: 'a' | 'b'): PropagationRow | undefined {
  return rows.find((r) => {
    const s = side === 'a' ? r.a : r.b
    return s !== null && entityKeyOf(s.ruleRef) === entityKey
  })
}

/**
 * 把规则差异翻译成面向业务的解释：每条规则说明“变了什么”，
 * 再结合当前输入快照的传播结果说明“对这次试算有没有影响、影响了多少”。
 */
export function explainComparison(diff: RuleSetDiff, rows: PropagationRow[], quoteA: PlanQuote, quoteB: PlanQuote): string[] {
  const lines: string[] = []

  if (quoteA.status !== quoteB.status) {
    const label = { ok: '可投保', incomplete: '信息不完整', unavailable: '无法投保' } as const
    lines.push(`投保状态变化：${label[quoteA.status]} → ${label[quoteB.status]}`)
  }

  for (const p of diff.modified) {
    const what = p.changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join('；')
    const row = findRowByEntity(rows, p.before.key, 'a')
    let impact = '当前输入未命中该规则，本次试算不受影响'
    if (row?.a && row.b) {
      const delta = round2(row.b.amountAfter - row.a.amountAfter)
      impact =
        delta === 0
          ? '当前输入仍命中，该步金额不变，但可能改变后续叠加基数'
          : `当前输入命中，该步累计金额 ${row.a.amountAfter} → ${row.b.amountAfter} 元`
    } else if (row?.a && !row.b) {
      impact = '当前输入在 A 侧命中，在 B 侧不再命中'
    } else if (!row?.a && row?.b) {
      impact = '当前输入在 A 侧未命中，在 B 侧变为命中'
    }
    lines.push(`「${p.after.name}」参数变化（${what}）：${impact}`)
  }

  for (const p of diff.priorityChanged) {
    const row = findRowByEntity(rows, p.before.key, 'a')
    const order =
      row?.aIndex != null && row.bIndex != null && row.aIndex !== row.bIndex
        ? `，叠加顺序第 ${row.aIndex + 1} 步 → 第 ${row.bIndex + 1} 步`
        : ''
    lines.push(`「${p.after.name}」优先级 ${p.before.priority} → ${p.after.priority}${order}`)
  }

  for (const e of diff.added) {
    const row = findRowByEntity(rows, e.key, 'b')
    const impact = row?.b
      ? `当前输入命中，B 侧${row.b.detail}`
      : '当前输入未命中，本次试算无影响'
    lines.push(`新增${KIND_LABEL[e.kind]}「${e.name}」：${impact}`)
  }

  for (const e of diff.removed) {
    const row = findRowByEntity(rows, e.key, 'a')
    const impact = row?.a
      ? `当前输入在 A 侧命中（${row.a.detail}），B 中已不存在`
      : '当前输入本就未命中，本次试算无影响'
    lines.push(`移除${KIND_LABEL[e.kind]}「${e.name}」：${impact}`)
  }

  if (lines.length === 0) {
    lines.push('两套规则集结构完全一致，当前输入下计算结果相同。')
  }
  return lines
}
