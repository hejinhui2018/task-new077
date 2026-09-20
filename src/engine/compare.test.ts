import { describe, expect, it } from 'vitest'
import { compareQuotes, replayTotals } from './compare'
import { RULESET_A, RULESET_B, type Discount, type Rider, type RuleSet } from './data'
import { calculateForPlan } from './engine'
import type { QuoteInput } from './types'

const INPUT: QuoteInput = { age: 35, regionId: 'east', sumInsured: 300000, riderIds: [] }

/** 最小化规则集工厂：每个用例只保留与断言相关的规则 */
function mkRuleSet(id: string, overrides: Partial<RuleSet> = {}): RuleSet {
  return {
    id,
    name: `规则集${id}`,
    description: '',
    minAge: 0,
    maxAge: 70,
    plans: [{ id: 'p1', name: '标准版', tagline: '', baseRatePer10W: 100 }],
    regions: [{ id: 'east', name: '华东', factor: 1 }],
    ageBands: [{ id: 'all', label: '统一费率', min: 0, max: 70, factor: 1 }],
    riders: [],
    discounts: [],
    ...overrides,
  }
}

const run = (i: QuoteInput, rs: RuleSet) => calculateForPlan(i, rs.plans[0], rs)

const mkDiscount = (overrides: Partial<Discount> = {}): Discount => ({
  id: 'd1',
  name: '优惠',
  description: '优惠说明',
  priority: 10,
  factor: 0.9,
  condition: { type: 'sumInsuredAtLeast', value: 100000 },
  ...overrides,
})

const mkRider = (overrides: Partial<Rider> = {}): Rider => ({
  id: 'r1',
  name: '附加险',
  description: '',
  feeType: 'flat',
  fee: 10,
  priority: 5,
  conflictsWith: [],
  ...overrides,
})

describe('重复比较：自身对照与确定性', () => {
  it('同一规则集与自身对照没有任何差异', () => {
    const rs = mkRuleSet('X', { discounts: [mkDiscount()] })
    const q = run(INPUT, rs)
    const c = compareQuotes(q, q)
    expect(c.stats.unchanged).toBe(c.steps.length)
    expect(c.stats.added + c.stats.removed + c.stats.modified + c.stats.propagated).toBe(0)
    expect(c.totalDelta).toBe(0)
    expect(c.firstDivergence).toBeNull()
    expect(c.excluded).toHaveLength(0)
  })

  it('同样的比较重复执行结果完全一致（纯函数）', () => {
    const a = run(INPUT, RULESET_A)
    const b = run(INPUT, RULESET_B)
    const c1 = compareQuotes(a, b)
    const c2 = compareQuotes(a, b)
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2))
  })
})

describe('部分匹配：只按规则 ID 对齐，不按名称猜测', () => {
  const a = mkRuleSet('A', {
    discounts: [
      mkDiscount({ id: 'loyal', name: '忠诚优惠', factor: 0.95 }),
      mkDiscount({ id: 'big', name: '大额优惠', priority: 20, factor: 0.9 }),
    ],
  })
  const b = mkRuleSet('B', {
    discounts: [
      mkDiscount({ id: 'big', name: '大额优惠', priority: 20, factor: 0.9 }),
      // 与 A 的 loyal 同名同参数，但 id 不同 → 不允许匹配
      mkDiscount({ id: 'loyal-v2', name: '忠诚优惠', factor: 0.95 }),
    ],
  })
  const c = compareQuotes(run(INPUT, a), run(INPUT, b))

  it('能匹配的规则正常对齐，不能匹配的各自记为移除 / 新增', () => {
    expect(c.stats.removed).toBe(1)
    expect(c.stats.added).toBe(1)
    expect(c.stats.modified).toBe(0)
    const removed = c.steps.find((s) => s.match.type === 'removed')
    const added = c.steps.find((s) => s.match.type === 'added')
    expect(removed?.key).toBe('discount-loyal')
    expect(added?.key).toBe('discount-loyal-v2')
  })

  it('同名同参数但 id 不同的规则不会被猜测为同一规则', () => {
    // 如果按名称猜测，loyal 与 loyal-v2 会被配成 modified 或 unchanged
    expect(c.steps.every((s) => s.match.type !== 'modified')).toBe(true)
    expect(c.stats.unchanged).toBe(4) // base / age / region / big
  })
})

describe('优先级变化：识别并反映执行顺序', () => {
  const a = mkRuleSet('A', {
    discounts: [
      mkDiscount({ id: 'x', name: 'X', priority: 10, factor: 0.9 }),
      mkDiscount({ id: 'y', name: 'Y', priority: 20, factor: 0.95 }),
    ],
  })
  const b = mkRuleSet('B', {
    discounts: [
      mkDiscount({ id: 'x', name: 'X', priority: 30, factor: 0.9 }),
      mkDiscount({ id: 'y', name: 'Y', priority: 20, factor: 0.95 }),
    ],
  })
  const c = compareQuotes(run(INPUT, a), run(INPUT, b))

  it('优先级变化被标记为修改，并给出前后值', () => {
    const x = c.steps.find((s) => s.key === 'discount-x')
    expect(x?.match.type).toBe('modified')
    if (x?.match.type !== 'modified') throw new Error('unreachable')
    expect(x.match.aspects).toContainEqual({ field: 'priority', before: '10', after: '30' })
  })

  it('对齐顺序跟随对照侧的执行顺序（X 提到 Y 之前）', () => {
    const keys = c.steps.map((s) => s.key)
    expect(keys.indexOf('discount-x')).toBeLessThan(keys.indexOf('discount-y'))
  })

  it('规则未变的 Y 因执行顺序变化被标记为影响传播', () => {
    const y = c.steps.find((s) => s.key === 'discount-y')
    expect(y?.match.type).toBe('propagated')
    if (y?.match.type !== 'propagated') throw new Error('unreachable')
    expect(y.match.causedBy).toBe('discount-x')
  })

  it('乘法可交换，总价不变', () => {
    expect(c.totalDelta).toBe(0)
  })
})

describe('影响传播：上游变化沿计算链传导', () => {
  const common = {
    regions: [{ id: 'east', name: '华东', factor: 1.5 }],
    ageBands: [{ id: 'all', label: '统一费率', min: 0, max: 70, factor: 2 }],
  }
  const a = mkRuleSet('A', common)
  const b = mkRuleSet('B', {
    ...common,
    plans: [{ id: 'p1', name: '标准版', tagline: '', baseRatePer10W: 120 }],
  })
  const c = compareQuotes(run(INPUT, a), run(INPUT, b))

  it('基础费率变化是直接修改', () => {
    const base = c.steps.find((s) => s.key === 'base-p1')
    expect(base?.match.type).toBe('modified')
  })

  it('下游年龄、地区规则本身未变，但被标记为影响传播并归因到基础保费', () => {
    expect(c.stats.propagated).toBe(2)
    for (const key of ['age-all', 'region-east']) {
      const step = c.steps.find((s) => s.key === key)
      expect(step?.match.type).toBe('propagated')
      if (step?.match.type !== 'propagated') throw new Error('unreachable')
      expect(step.match.causedBy).toBe('base-p1')
    }
    expect(c.totalDelta).toBe(180) // 900 → 1080
  })

  it('重放任意节点的两侧累计保费', () => {
    expect(replayTotals(c.steps, 0)).toEqual({ base: 300, compare: 360 })
    expect(replayTotals(c.steps, 1)).toEqual({ base: 600, compare: 720 })
    expect(replayTotals(c.steps, 2)).toEqual({ base: 900, compare: 1080 })
    expect(replayTotals(c.steps, -1)).toEqual({ base: 0, compare: 0 })
    expect(replayTotals(c.steps, 99)).toEqual({ base: 900, compare: 1080 })
  })
})

describe('边界值对照：年龄边界移动', () => {
  const a = mkRuleSet('A', {
    discounts: [mkDiscount({ id: 'youth', condition: { type: 'ageBetween', min: 18, max: 30 } })],
  })
  const b = mkRuleSet('B', {
    discounts: [mkDiscount({ id: 'youth', condition: { type: 'ageBetween', min: 18, max: 28 } })],
  })

  it('边界外（30 岁）：基线命中、对照不命中 → 移除', () => {
    const c = compareQuotes(run({ ...INPUT, age: 30 }, a), run({ ...INPUT, age: 30 }, b))
    expect(c.stats.removed).toBe(1)
    const removed = c.steps.find((s) => s.match.type === 'removed')
    expect(removed?.key).toBe('discount-youth')
  })

  it('边界内（28 岁）：两侧都命中，但适用范围被标记为已修改', () => {
    const c = compareQuotes(run({ ...INPUT, age: 28 }, a), run({ ...INPUT, age: 28 }, b))
    expect(c.stats.modified).toBe(1)
    const modified = c.steps.find((s) => s.match.type === 'modified')
    if (modified?.match.type !== 'modified') throw new Error('unreachable')
    expect(modified.match.aspects).toContainEqual({
      field: 'scope',
      before: '年龄 18–30 周岁',
      after: '年龄 18–28 周岁',
    })
  })

  it('两侧都不命中（17 岁）：无差异', () => {
    const c = compareQuotes(run({ ...INPUT, age: 17 }, a), run({ ...INPUT, age: 17 }, b))
    expect(c.firstDivergence).toBeNull()
  })
})

describe('互斥规则翻转：优先级互换导致取舍反转', () => {
  const m1 = mkRider({ id: 'm1', name: '医疗基础', fee: 10, priority: 9, conflictsWith: ['m2'] })
  const m2 = mkRider({ id: 'm2', name: '医疗升级', fee: 20, priority: 8, conflictsWith: ['m1'] })
  const a = mkRuleSet('A', { riders: [m1, m2] })
  const b = mkRuleSet('B', { riders: [{ ...m1, priority: 5 }, m2] })
  const i: QuoteInput = { ...INPUT, riderIds: ['m1', 'm2'] }
  const c = compareQuotes(run(i, a), run(i, b))

  it('保留方互换：m1 从命中变未生效，m2 从未生效变命中', () => {
    const removed = c.steps.find((s) => s.match.type === 'removed')
    const added = c.steps.find((s) => s.match.type === 'added')
    expect(removed?.key).toBe('rider-m1')
    expect(added?.key).toBe('rider-m2')
  })

  it('未生效规则对照同步反映翻转', () => {
    const onlyCompare = c.excluded.find((e) => e.type === 'onlyCompare')
    const onlyBase = c.excluded.find((e) => e.type === 'onlyBase')
    expect(onlyCompare?.type === 'onlyCompare' && onlyCompare.b.ruleId).toBe('rider-m1')
    expect(onlyCompare?.type === 'onlyCompare' && onlyCompare.otherSide).toBe('hit')
    expect(onlyBase?.type === 'onlyBase' && onlyBase.a.ruleId).toBe('rider-m2')
    expect(onlyBase?.type === 'onlyBase' && onlyBase.otherSide).toBe('hit')
  })

  it('总价差体现取舍结果（+10 → +20）', () => {
    expect(c.totalBase).toBe(310)
    expect(c.totalCompare).toBe(320)
    expect(c.totalDelta).toBe(10)
  })

  it('重放经过移除 / 新增节点时两侧各自推进', () => {
    const keys = c.steps.map((s) => s.key)
    const idxRemoved = keys.indexOf('rider-m1')
    const idxAdded = keys.indexOf('rider-m2')
    expect(replayTotals(c.steps, idxRemoved)).toEqual({ base: 310, compare: 300 })
    expect(replayTotals(c.steps, idxAdded)).toEqual({ base: 310, compare: 320 })
  })
})

describe('状态变化：一侧无法投保', () => {
  it('72 岁：基线（上限 70）无法投保，对照（上限 75）可投保', () => {
    const a = mkRuleSet('A')
    const b = mkRuleSet('B', {
      maxAge: 75,
      ageBands: [{ id: 'all', label: '统一费率', min: 0, max: 75, factor: 1 }],
    })
    const c = compareQuotes(run({ ...INPUT, age: 72 }, a), run({ ...INPUT, age: 72 }, b))
    expect(c.statusBase).toBe('unavailable')
    expect(c.statusCompare).toBe('ok')
    expect(c.steps).toHaveLength(0)
    expect(c.totalBase).toBeNull()
    expect(c.totalCompare).toBe(300)
    expect(c.totalDelta).toBeNull()
  })
})

describe('集成：现行规则 A vs 修订方案 B', () => {
  it('默认输入下的标准版对照', () => {
    const planA = RULESET_A.plans.find((p) => p.id === 'standard')!
    const planB = RULESET_B.plans.find((p) => p.id === 'standard')!
    const c = compareQuotes(
      calculateForPlan(INPUT, planA, RULESET_A),
      calculateForPlan(INPUT, planB, RULESET_B),
    )
    expect(c.totalBase).toBe(554.4)
    expect(c.totalCompare).toBe(511.21)
    expect(c.totalDelta).toBe(-43.19)

    const keys = c.steps.map((s) => s.key)
    // 新增：线上投保优惠
    const added = c.steps.filter((s) => s.match.type === 'added').map((s) => s.key)
    expect(added).toEqual(['discount-online'])
    // 已修改：基础费率、壮年区间边界、地区系数
    const modified = c.steps.filter((s) => s.match.type === 'modified').map((s) => s.key)
    expect(modified).toEqual(expect.arrayContaining(['base-standard', 'age-prime', 'region-east']))
    expect(keys).not.toContain('discount-youth') // 35 岁两侧都不命中青年优惠
  })

  it('互斥医疗险：A 中有取舍提示，B 移除社保内款后提示消失', () => {
    const i: QuoteInput = { ...INPUT, riderIds: ['acc-medical-basic', 'acc-medical-plus'] }
    const planA = RULESET_A.plans.find((p) => p.id === 'standard')!
    const planB = RULESET_B.plans.find((p) => p.id === 'standard')!
    const c = compareQuotes(calculateForPlan(i, planA, RULESET_A), calculateForPlan(i, planB, RULESET_B))

    // A 中社保内款被互斥掉；B 中该规则已下线
    const onlyBase = c.excluded.find((e) => e.type === 'onlyBase')
    expect(onlyBase?.type === 'onlyBase' && onlyBase.a.ruleId).toBe('rider-acc-medical-basic')
    expect(onlyBase?.type === 'onlyBase' && onlyBase.otherSide).toBe('absent')
    // 互斥提示只出现在基线侧
    expect(c.messagesRemoved.some((m) => m.includes('互斥'))).toBe(true)
    expect(c.messagesAdded).toHaveLength(0)
  })
})
