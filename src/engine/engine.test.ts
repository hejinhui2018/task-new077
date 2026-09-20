import { describe, expect, it } from 'vitest'
import { calculateForPlan } from './engine'
import { DEFAULT_RULESET_A, cloneRuleset } from './ruleset'
import type { QuoteInput } from './types'

const A = DEFAULT_RULESET_A
const basic = A.plans.find((p) => p.id === 'basic')!

const input = (overrides: Partial<QuoteInput> = {}): QuoteInput => ({
  age: 35,
  regionId: 'north',
  sumInsured: 100000,
  riderIds: [],
  ...overrides,
})

const totalOf = (i: QuoteInput) => calculateForPlan(i, basic, A)

describe('引擎 · 边界值', () => {
  it('年龄区间含端点：17 岁未成年费率，18 岁青年费率', () => {
    // 基础 90 × 0.5（未成年）× 1.0（华北）= 45
    expect(totalOf(input({ age: 17 })).total).toBe(45)
    // 90 × 1.0（青年）× 1.0 × 0.9（青年优惠 18–30）= 81
    expect(totalOf(input({ age: 18 })).total).toBe(81)
  })

  it('青年优惠边界：30 岁命中，31 岁不再命中', () => {
    expect(totalOf(input({ age: 30 })).total).toBe(81)
    const q31 = totalOf(input({ age: 31 }))
    // 90 × 1.4（壮年）= 126，无青年优惠
    expect(q31.total).toBe(126)
    expect(q31.steps.some((s) => s.ruleId === 'discount-youth')).toBe(false)
  })

  it('壮年 / 中年 / 老年边界：45→46、60→61 跨档', () => {
    expect(totalOf(input({ age: 45 })).total).toBe(126)
    expect(totalOf(input({ age: 46 })).total).toBe(180)
    expect(totalOf(input({ age: 60 })).total).toBe(180)
    expect(totalOf(input({ age: 61 })).total).toBe(288)
  })

  it('投保年龄范围：0 与 70 可投，71 不可投', () => {
    expect(totalOf(input({ age: 0 })).status).toBe('ok')
    expect(totalOf(input({ age: 70 })).status).toBe('ok')
    const q71 = totalOf(input({ age: 71 }))
    expect(q71.status).toBe('unavailable')
    expect(q71.messages[0]).toContain('无法投保')
  })

  it('大额保单优惠边界：50 万整命中，499999 不命中', () => {
    const hit = totalOf(input({ sumInsured: 500000 }))
    // 450 × 1.4 = 630，×0.95 = 598.5
    expect(hit.steps.some((s) => s.ruleId === 'discount-big-policy')).toBe(true)
    expect(hit.total).toBe(598.5)

    const miss = totalOf(input({ sumInsured: 499999 }))
    expect(miss.steps.some((s) => s.ruleId.startsWith('discount-'))).toBe(false)
  })

  it('附加险适用年龄边界：住院津贴 18–60 岁，含端点', () => {
    const at18 = totalOf(input({ age: 18, riderIds: ['hospital-allowance'] }))
    expect(at18.steps.some((s) => s.ruleId === 'rider-hospital-allowance')).toBe(true)

    const at17 = totalOf(input({ age: 17, riderIds: ['hospital-allowance'] }))
    expect(at17.excluded.some((e) => e.ruleId === 'rider-hospital-allowance')).toBe(true)

    expect(totalOf(input({ age: 60, riderIds: ['hospital-allowance'] })).steps.some((s) => s.ruleId === 'rider-hospital-allowance')).toBe(true)
    expect(totalOf(input({ age: 61, riderIds: ['hospital-allowance'] })).excluded.some((e) => e.ruleId === 'rider-hospital-allowance')).toBe(true)
  })

  it('附加险最低保额边界：30 万整可投，299999 不可投', () => {
    const hit = totalOf(input({ sumInsured: 300000, riderIds: ['waiver'] }))
    expect(hit.steps.some((s) => s.ruleId === 'rider-waiver')).toBe(true)

    const miss = totalOf(input({ sumInsured: 299999, riderIds: ['waiver'] }))
    expect(miss.excluded.some((e) => e.ruleId === 'rider-waiver')).toBe(true)
  })
})

describe('引擎 · 互斥规则', () => {
  const both = input({ riderIds: ['acc-medical-basic', 'acc-medical-plus'] })

  it('同时勾选互斥附加险：优先级高者生效，低者进入未生效列表', () => {
    const q = totalOf(both)
    // plus 优先级 8 > basic 5：保留 plus（+38），basic 被互斥
    expect(q.steps.some((s) => s.ruleId === 'rider-acc-medical-plus')).toBe(true)
    expect(q.steps.some((s) => s.ruleId === 'rider-acc-medical-basic')).toBe(false)
    const excluded = q.excluded.find((e) => e.ruleId === 'rider-acc-medical-basic')
    expect(excluded?.reason).toContain('互斥')
    // 90 × 1.4 = 126 + 38 = 164
    expect(q.total).toBe(164)
    expect(q.messages.some((m) => m.includes('互斥'))).toBe(true)
  })

  it('优先级反转后取舍随之反转', () => {
    const swapped = cloneRuleset(A)
    swapped.riders.find((r) => r.id === 'acc-medical-basic')!.priority = 9
    swapped.riders.find((r) => r.id === 'acc-medical-plus')!.priority = 5
    const q = calculateForPlan(both, basic, swapped)
    expect(q.steps.some((s) => s.ruleId === 'rider-acc-medical-basic')).toBe(true)
    expect(q.excluded.some((e) => e.ruleId === 'rider-acc-medical-plus')).toBe(true)
    // 126 + 20 = 146
    expect(q.total).toBe(146)
  })
})

describe('引擎 · 输入与规则集健壮性', () => {
  it('输入不完整：缺少年龄时返回 incomplete 并列出缺失项', () => {
    const q = totalOf(input({ age: null }))
    expect(q.status).toBe('incomplete')
    expect(q.missing).toContain('年龄')
  })

  it('勾选规则集中不存在的附加险：不计价并明示', () => {
    const q = totalOf(input({ riderIds: ['ghost-rider'] }))
    expect(q.excluded.some((e) => e.ruleId === 'rider-ghost-rider')).toBe(true)
    expect(q.messages.some((m) => m.includes('不存在'))).toBe(true)
    expect(q.total).toBe(126)
  })

  it('规则集中不存在所选地区：unavailable', () => {
    const noEast = cloneRuleset(A)
    noEast.regions = noEast.regions.filter((r) => r.id !== 'east')
    const q = calculateForPlan(input({ regionId: 'east' }), basic, noEast)
    expect(q.status).toBe('unavailable')
  })

  it('纯函数：同一输入 + 同一规则集，重复计算结果完全一致', () => {
    const i = input({ riderIds: ['acc-medical-basic', 'acc-medical-plus', 'waiver'] })
    expect(totalOf(i)).toEqual(totalOf(i))
  })
})
