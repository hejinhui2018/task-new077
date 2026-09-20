import {
  AGE_BANDS,
  DISCOUNTS,
  MAX_AGE,
  MIN_AGE,
  PLANS,
  REGIONS,
  RIDERS,
  type AgeBand,
  type Discount,
  type Plan,
  type Region,
  type Rider,
} from './data'

/**
 * 一套独立完整的定价规则集。
 * 对照功能从同一输入快照分别用两套 RuleSet 计算，互不共享任何规则数据。
 */
export interface RuleSet {
  id: string
  name: string
  /** 产品投保年龄范围 */
  minAge: number
  maxAge: number
  plans: Plan[]
  regions: Region[]
  ageBands: AgeBand[]
  discounts: Discount[]
  riders: Rider[]
}

export const cloneRuleset = (rs: RuleSet): RuleSet => JSON.parse(JSON.stringify(rs)) as RuleSet

/** 现行规则 A：即内置费率数据。 */
export const DEFAULT_RULESET_A: RuleSet = {
  id: 'A',
  name: '现行规则 A',
  minAge: MIN_AGE,
  maxAge: MAX_AGE,
  plans: PLANS,
  regions: REGIONS,
  ageBands: AGE_BANDS,
  discounts: DISCOUNTS,
  riders: RIDERS,
}

/**
 * 候选规则 B（示例）：在 A 的基础上做了几类典型调整 ——
 * 边界值变化（青年优惠 30→35 岁、住院津贴上限 60→65 岁）、
 * 优先级变化（大额保单优惠 20→30）、移除（保费豁免）、新增（续保忠诚优惠）。
 */
function buildDefaultRulesetB(): RuleSet {
  const b = cloneRuleset(DEFAULT_RULESET_A)
  b.id = 'B'
  b.name = '候选规则 B'

  const youth = b.discounts.find((d) => d.id === 'youth')
  if (youth) youth.condition = { type: 'ageBetween', min: 18, max: 35 }

  const bigPolicy = b.discounts.find((d) => d.id === 'big-policy')
  if (bigPolicy) bigPolicy.priority = 30

  const allowance = b.riders.find((r) => r.id === 'hospital-allowance')
  if (allowance) allowance.maxAge = 65

  b.riders = b.riders.filter((r) => r.id !== 'waiver')

  b.discounts.push({
    id: 'loyalty',
    name: '续保忠诚优惠',
    description: '续保客户且保额达到 100 万，保费 98 折',
    priority: 5,
    factor: 0.98,
    condition: { type: 'sumInsuredAtLeast', value: 1000000 },
  })

  return b
}

export const DEFAULT_RULESET_B: RuleSet = buildDefaultRulesetB()

/** 为新建规则生成集合内唯一的稳定 id（不使用名称，避免与展示文案耦合）。 */
export function nextRuleId(kind: string, existing: Array<{ id: string }>): string {
  const ids = new Set(existing.map((e) => e.id))
  let n = 1
  while (ids.has(`${kind}-custom-${n}`)) n += 1
  return `${kind}-custom-${n}`
}
