import {
  AGE_BANDS,
  DISCOUNTS,
  MAX_AGE,
  MIN_AGE,
  PLANS,
  REGIONS,
  RIDERS,
  type Discount,
  type Plan,
  type Rider,
} from './data'
import type { CalcStep, ExcludedRule, PlanQuote, QuoteInput } from './types'

export const round2 = (n: number): number => Math.round(n * 100) / 100

const unitsOf = (sumInsured: number): number => sumInsured / 100000

/** 附加险是否落在适用范围内；不在则返回原因文字。 */
function riderScopeProblem(rider: Rider, input: { age: number; sumInsured: number }): string | null {
  if (rider.minAge !== undefined && input.age < rider.minAge) {
    return `适用年龄 ${rider.minAge}–${rider.maxAge} 周岁，当前 ${input.age} 岁`
  }
  if (rider.maxAge !== undefined && input.age > rider.maxAge) {
    return `适用年龄 ${rider.minAge}–${rider.maxAge} 周岁，当前 ${input.age} 岁`
  }
  if (rider.minSumInsured !== undefined && input.sumInsured < rider.minSumInsured) {
    return `要求保额 ≥ ${rider.minSumInsured / 10000} 万，当前 ${input.sumInsured / 10000} 万`
  }
  return null
}

function riderScopeText(rider: Rider): string {
  const parts: string[] = []
  if (rider.minAge !== undefined || rider.maxAge !== undefined) {
    parts.push(`适用年龄 ${rider.minAge ?? MIN_AGE}–${rider.maxAge ?? MAX_AGE} 周岁`)
  }
  if (rider.minSumInsured !== undefined) parts.push(`保额 ≥ ${rider.minSumInsured / 10000} 万`)
  return parts.length ? parts.join('；') : '所有投保人'
}

function discountApplies(d: Discount, input: { age: number; sumInsured: number }): boolean {
  const c = d.condition
  if (c.type === 'sumInsuredAtLeast') return input.sumInsured >= c.value
  return input.age >= c.min && input.age <= c.max
}

function discountScopeText(d: Discount): string {
  const c = d.condition
  return c.type === 'sumInsuredAtLeast' ? `保额 ≥ ${c.value / 10000} 万` : `年龄 ${c.min}–${c.max} 周岁`
}

function incompleteQuote(plan: Plan, missing: string[]): PlanQuote {
  return {
    planId: plan.id,
    planName: plan.name,
    status: 'incomplete',
    missing,
    messages: [`请补充投保条件：${missing.join('、')}`],
    total: 0,
    steps: [],
    excluded: [],
  }
}

/** 计算单个方案。纯函数：同一输入永远得到同一结果，便于测试与撤销/重做。 */
export function calculateForPlan(input: QuoteInput, plan: Plan): PlanQuote {
  // 1. 输入完整性校验
  const missing: string[] = []
  if (input.age === null) missing.push('年龄')
  if (input.regionId === null) missing.push('地区')
  if (input.sumInsured === null) missing.push('保障额度')
  if (missing.length > 0) return incompleteQuote(plan, missing)

  const age = input.age
  const sumInsured = input.sumInsured
  const region = REGIONS.find((r) => r.id === input.regionId)
  if (!region) return incompleteQuote(plan, ['地区'])

  // 2. 产品投保年龄范围
  if (age < MIN_AGE || age > MAX_AGE) {
    return {
      planId: plan.id,
      planName: plan.name,
      status: 'unavailable',
      missing: [],
      messages: [`本产品投保年龄为 ${MIN_AGE}–${MAX_AGE} 周岁，当前 ${age} 岁无法投保`],
      total: 0,
      steps: [],
      excluded: [],
    }
  }

  const steps: CalcStep[] = []
  const excluded: ExcludedRule[] = []
  const messages: string[] = []
  const units = unitsOf(sumInsured)

  // 3. 基础保费
  let total = round2(units * plan.baseRatePer10W)
  steps.push({
    ruleId: `base-${plan.id}`,
    ruleName: `基础保费（${plan.name}）`,
    kind: 'base',
    priority: 100,
    scopeText: '所有投保人',
    detail: `${sumInsured / 10000} 万保额 ÷ 10 万 × ${plan.baseRatePer10W} 元`,
    amountBefore: 0,
    amountAfter: total,
  })

  // 4. 年龄费率（区间含端点，scope 校验保证必命中一条）
  const band = AGE_BANDS.find((b) => age >= b.min && age <= b.max)
  if (band) {
    const before = total
    total = round2(total * band.factor)
    steps.push({
      ruleId: `age-${band.id}`,
      ruleName: band.label,
      kind: 'age',
      priority: 90,
      scopeText: `年龄 ${band.min}–${band.max} 周岁`,
      detail: `${age} 岁落在 ${band.min}–${band.max} 岁区间，费率 ×${band.factor}`,
      amountBefore: before,
      amountAfter: total,
    })
  }

  // 5. 地区系数
  {
    const before = total
    total = round2(total * region.factor)
    steps.push({
      ruleId: `region-${region.id}`,
      ruleName: `地区系数（${region.name}）`,
      kind: 'region',
      priority: 80,
      scopeText: `投保地区为${region.name}`,
      detail: `${region.name}地区系数 ×${region.factor}`,
      amountBefore: before,
      amountAfter: total,
    })
  }

  // 6. 折扣：全部命中后按优先级从高到低依次叠加
  const discounts = DISCOUNTS.filter((d) => discountApplies(d, { age, sumInsured })).sort(
    (a, b) => b.priority - a.priority,
  )
  for (const d of discounts) {
    const before = total
    total = round2(total * d.factor)
    steps.push({
      ruleId: `discount-${d.id}`,
      ruleName: d.name,
      kind: 'discount',
      priority: d.priority,
      scopeText: discountScopeText(d),
      detail: `${d.description}，×${d.factor}`,
      amountBefore: before,
      amountAfter: total,
    })
  }

  // 7. 附加险：先按适用范围过滤，再按互斥 + 优先级取舍
  const selected = RIDERS.filter((r) => input.riderIds.includes(r.id))
  const inScope: Rider[] = []
  for (const r of selected) {
    const problem = riderScopeProblem(r, { age, sumInsured })
    if (problem) {
      excluded.push({ ruleId: `rider-${r.id}`, ruleName: r.name, reason: `不在适用范围：${problem}` })
      messages.push(`附加险「${r.name}」未生效：${problem}`)
    } else {
      inScope.push(r)
    }
  }

  const kept: Rider[] = []
  for (const r of [...inScope].sort((a, b) => b.priority - a.priority)) {
    const winner = kept.find((k) => k.conflictsWith.includes(r.id) || r.conflictsWith.includes(k.id))
    if (winner) {
      excluded.push({
        ruleId: `rider-${r.id}`,
        ruleName: r.name,
        reason: `与「${winner.name}」互斥，优先级较低（${r.priority} < ${winner.priority}）`,
      })
      messages.push(`附加险「${r.name}」与「${winner.name}」互斥，已按优先级保留「${winner.name}」`)
    } else {
      kept.push(r)
    }
  }

  for (const r of kept) {
    const fee = r.feeType === 'per10W' ? round2(units * r.fee) : r.fee
    const before = total
    total = round2(total + fee)
    steps.push({
      ruleId: `rider-${r.id}`,
      ruleName: `附加险：${r.name}`,
      kind: 'rider',
      priority: r.priority,
      scopeText: riderScopeText(r),
      detail:
        r.feeType === 'per10W'
          ? `${sumInsured / 10000} 万保额 ÷ 10 万 × ${r.fee} 元 = +${fee} 元`
          : `定额年费 +${fee} 元`,
      amountBefore: before,
      amountAfter: total,
    })
  }

  return { planId: plan.id, planName: plan.name, status: 'ok', missing: [], messages, total, steps, excluded }
}

export function calculateAll(input: QuoteInput): PlanQuote[] {
  return PLANS.map((p) => calculateForPlan(input, p))
}

/** 两次输入之间的字段级差异，用于“调整前 / 调整后”对照。 */
export function diffInputs(a: QuoteInput, b: QuoteInput): string[] {
  const changes: string[] = []
  const regionName = (id: string | null) => REGIONS.find((r) => r.id === id)?.name ?? '未选择'
  const riderName = (id: string) => RIDERS.find((r) => r.id === id)?.name ?? id
  const sumText = (v: number | null) => (v === null ? '未选择' : `${v / 10000} 万`)

  if (a.age !== b.age) changes.push(`年龄：${a.age ?? '未填写'} → ${b.age ?? '未填写'}`)
  if (a.regionId !== b.regionId) changes.push(`地区：${regionName(a.regionId)} → ${regionName(b.regionId)}`)
  if (a.sumInsured !== b.sumInsured) changes.push(`保障额度：${sumText(a.sumInsured)} → ${sumText(b.sumInsured)}`)

  const added = b.riderIds.filter((id) => !a.riderIds.includes(id))
  const removed = a.riderIds.filter((id) => !b.riderIds.includes(id))
  if (added.length > 0) changes.push(`附加险新增：${added.map(riderName).join('、')}`)
  if (removed.length > 0) changes.push(`附加险移除：${removed.map(riderName).join('、')}`)
  return changes
}

export interface StepDiff {
  added: CalcStep[]
  removed: CalcStep[]
  changed: Array<{ prev: CalcStep; curr: CalcStep }>
}

/** 两次计算命中规则的差异（按 ruleId 对齐）。 */
export function diffSteps(prev: CalcStep[], curr: CalcStep[]): StepDiff {
  const prevMap = new Map(prev.map((s) => [s.ruleId, s]))
  const currMap = new Map(curr.map((s) => [s.ruleId, s]))
  return {
    added: curr.filter((s) => !prevMap.has(s.ruleId)),
    removed: prev.filter((s) => !currMap.has(s.ruleId)),
    changed: curr
      .filter((s) => prevMap.has(s.ruleId) && prevMap.get(s.ruleId)!.detail !== s.detail)
      .map((s) => ({ prev: prevMap.get(s.ruleId)!, curr: s })),
  }
}
