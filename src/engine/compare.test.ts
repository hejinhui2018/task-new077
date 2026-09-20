import { describe, expect, it } from 'vitest'
import { buildPropagation, diffRuleSets, explainComparison, replayTotals } from './compare'
import { calculateForPlan } from './engine'
import { DEFAULT_RULESET_A, cloneRuleset } from './ruleset'
import type { QuoteInput } from './types'

const A = DEFAULT_RULESET_A
const ENTITY_COUNT = 3 + 5 + 4 + 2 + 6 // 方案 + 年龄段 + 地区 + 折扣 + 附加险

const input = (overrides: Partial<QuoteInput> = {}): QuoteInput => ({
  age: 25,
  regionId: 'north',
  sumInsured: 100000,
  riderIds: [],
  ...overrides,
})

describe('规则匹配 · 等价与重复比较', () => {
  it('与自身比较：全部等价，无新增 / 移除 / 变化', () => {
    const diff = diffRuleSets(A, cloneRuleset(A))
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
    expect(diff.priorityChanged).toHaveLength(0)
    expect(diff.unchanged).toHaveLength(ENTITY_COUNT)
    expect(diff.matchedMap.size).toBe(ENTITY_COUNT)
  })

  it('重复比较：同一对规则集比较两次，结果完全一致（纯函数）', () => {
    const b = cloneRuleset(A)
    b.discounts.find((d) => d.id === 'youth')!.priority = 99
    b.riders = b.riders.filter((r) => r.id !== 'waiver')
    const d1 = diffRuleSets(A, b)
    const d2 = diffRuleSets(A, b)
    expect(d1).toEqual(d2)
  })

  it('结构等价但 id 不同：仍按等价规则匹配（匹配看结构不看标识）', () => {
    const b = cloneRuleset(A)
    b.discounts.find((d) => d.id === 'youth')!.id = 'youth-2'
    const diff = diffRuleSets(A, b)
    expect(diff.unchanged).toHaveLength(ENTITY_COUNT)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.matchedMap.get('discount:youth')).toBe('discount:youth-2')
  })
})

describe('规则匹配 · 新增 / 移除 / 优先级 / 参数变化', () => {
  it('新增规则：只出现在 B 中', () => {
    const b = cloneRuleset(A)
    b.discounts.push({
      id: 'extra',
      name: '额外优惠',
      description: '测试',
      priority: 1,
      factor: 0.98,
      condition: { type: 'ageBetween', min: 0, max: 70 },
    })
    const diff = diffRuleSets(A, b)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].id).toBe('extra')
    expect(diff.removed).toHaveLength(0)
  })

  it('移除规则：只出现在 A 中', () => {
    const b = cloneRuleset(A)
    b.riders = b.riders.filter((r) => r.id !== 'waiver')
    const diff = diffRuleSets(A, b)
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0].id).toBe('waiver')
  })

  it('优先级变化：结构不变只改优先级，不计入新增 / 移除 / 参数变化', () => {
    const b = cloneRuleset(A)
    b.discounts.find((d) => d.id === 'youth')!.priority = 99
    const diff = diffRuleSets(A, b)
    expect(diff.priorityChanged).toHaveLength(1)
    expect(diff.priorityChanged[0].before.priority).toBe(10)
    expect(diff.priorityChanged[0].after.priority).toBe(99)
    expect(diff.priorityChanged[0].changes).toContainEqual({ label: '优先级', before: '10', after: '99' })
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('参数变化：同一稳定 id 的边界值修改被逐字段展示', () => {
    const b = cloneRuleset(A)
    const youth = b.discounts.find((d) => d.id === 'youth')!
    youth.condition = { type: 'ageBetween', min: 18, max: 35 }
    const diff = diffRuleSets(A, b)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].before.id).toBe('youth')
    expect(diff.modified[0].changes).toContainEqual({ label: '年龄上限', before: '30 岁', after: '35 岁' })
  })

  it('参数变化：地区系数与方案基础费率也能按 id 配对', () => {
    const b = cloneRuleset(A)
    b.regions.find((r) => r.id === 'east')!.factor = 1.2
    b.plans.find((p) => p.id === 'basic')!.baseRatePer10W = 100
    const diff = diffRuleSets(A, b)
    const keys = diff.modified.map((p) => p.before.key)
    expect(keys).toContain('region:east')
    expect(keys).toContain('base:basic')
  })

  it('部分匹配：只改一部分规则时，其余规则保持等价', () => {
    const b = cloneRuleset(A)
    b.ageBands.find((x) => x.id === 'youth')!.max = 35 // 参数变化
    b.riders = b.riders.filter((r) => r.id !== 'waiver') // 移除
    b.discounts.push({
      id: 'extra',
      name: '额外优惠',
      description: '测试',
      priority: 1,
      factor: 0.98,
      condition: { type: 'ageBetween', min: 0, max: 70 },
    }) // 新增
    const diff = diffRuleSets(A, b)
    expect(diff.modified).toHaveLength(1)
    expect(diff.removed).toHaveLength(1)
    expect(diff.added).toHaveLength(1)
    expect(diff.unchanged).toHaveLength(ENTITY_COUNT - 2)
    expect(diff.matchedMap.size).toBe(ENTITY_COUNT - 1)
  })
})

describe('规则匹配 · 不按名称猜测', () => {
  it('同名不同 id 且结构不同：只能算新增 + 移除，不得配对为参数变化', () => {
    const b = cloneRuleset(A)
    b.discounts = b.discounts.filter((d) => d.id !== 'youth')
    b.discounts.push({
      id: 'youth-copy',
      name: '青年费率优惠', // 与被移除规则同名
      description: '18–30 周岁投保，保费 85 折',
      priority: 10,
      factor: 0.85, // 结构不同
      condition: { type: 'ageBetween', min: 18, max: 30 },
    })
    const diff = diffRuleSets(A, b)
    expect(diff.modified).toHaveLength(0)
    expect(diff.removed.map((e) => e.id)).toContain('youth')
    expect(diff.added.map((e) => e.id)).toContain('youth-copy')
  })

  it('仅改名（id 与结构不变）：仍算等价，名称差异仅作展示', () => {
    const b = cloneRuleset(A)
    b.discounts.find((d) => d.id === 'youth')!.name = '青年特惠'
    const diff = diffRuleSets(A, b)
    expect(diff.unchanged).toHaveLength(ENTITY_COUNT)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    const pair = diff.unchanged.find((p) => p.before.key === 'discount:youth')!
    expect(pair.changes.some((c) => c.label === '名称')).toBe(true)
  })
})

describe('影响传播', () => {
  const basic = A.plans.find((p) => p.id === 'basic')!

  it('折扣系数变化：对应步骤金额变化并传导到合计', () => {
    const b = cloneRuleset(A)
    b.discounts.find((d) => d.id === 'youth')!.factor = 0.85
    const diff = diffRuleSets(A, b)
    const qa = calculateForPlan(input(), basic, A)
    const qb = calculateForPlan(input(), basic, b)
    // A：90 × 1.0 × 1.0 × 0.9 = 81；B：90 × 0.85 = 76.5
    expect(qa.total).toBe(81)
    expect(qb.total).toBe(76.5)

    const rows = buildPropagation(qa, qb, diff)
    const youthRow = rows.find((r) => r.a?.ruleRef.kind === 'discount' && r.a.ruleRef.id === 'youth')!
    expect(youthRow.status).toBe('modified')
    expect(youthRow.a?.amountAfter).toBe(81)
    expect(youthRow.b?.amountAfter).toBe(76.5)

    const totals = replayTotals(rows, rows.length)
    expect(totals.a).toBe(81)
    expect(totals.b).toBe(76.5)
  })

  it('新增且命中的规则：在传播表中出现为 added 行', () => {
    const b = cloneRuleset(A)
    b.discounts.push({
      id: 'extra',
      name: '额外优惠',
      description: '测试',
      priority: 5,
      factor: 0.98,
      condition: { type: 'ageBetween', min: 0, max: 70 },
    })
    const diff = diffRuleSets(A, b)
    const qa = calculateForPlan(input(), basic, A)
    const qb = calculateForPlan(input(), basic, b)
    expect(qb.total).toBe(79.38) // 81 × 0.98

    const rows = buildPropagation(qa, qb, diff)
    const added = rows.find((r) => r.b?.ruleRef.id === 'extra')!
    expect(added.status).toBe('added')
    expect(added.a).toBeNull()
  })

  it('规则未命中时不产生传播行，解释中说明无影响', () => {
    const b = cloneRuleset(A)
    b.discounts.push({
      id: 'big-only',
      name: '百万专享',
      description: '测试',
      priority: 5,
      factor: 0.9,
      condition: { type: 'sumInsuredAtLeast', value: 1000000 },
    })
    const diff = diffRuleSets(A, b)
    const qa = calculateForPlan(input(), basic, A)
    const qb = calculateForPlan(input(), basic, b)
    expect(qa.total).toBe(qb.total)
    const lines = explainComparison(diff, buildPropagation(qa, qb, diff), qa, qb)
    expect(lines.some((l) => l.includes('新增') && l.includes('无影响'))).toBe(true)
  })

  it('差异解释：完全一致时明确说明', () => {
    const diff = diffRuleSets(A, cloneRuleset(A))
    const qa = calculateForPlan(input(), basic, A)
    const lines = explainComparison(diff, buildPropagation(qa, qa, diff), qa, qa)
    expect(lines.some((l) => l.includes('完全一致'))).toBe(true)
  })

  it('重放累计：从差异节点起逐步推进，累计金额与轨迹一致', () => {
    const b = cloneRuleset(A)
    b.discounts.find((d) => d.id === 'youth')!.factor = 0.85
    const diff = diffRuleSets(A, b)
    const qa = calculateForPlan(input(), basic, A)
    const qb = calculateForPlan(input(), basic, b)
    const rows = buildPropagation(qa, qb, diff)
    const youthIndex = rows.findIndex((r) => r.a?.ruleRef.kind === 'discount' && r.a.ruleRef.id === 'youth')
    // 重放到差异节点之前：两侧累计相等
    const before = replayTotals(rows, youthIndex)
    expect(before.a).toBe(before.b)
    // 重放过差异节点：出现分叉
    const after = replayTotals(rows, youthIndex + 1)
    expect(after.a).toBe(81)
    expect(after.b).toBe(76.5)
  })
})
