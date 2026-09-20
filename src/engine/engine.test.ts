import { describe, expect, it } from 'vitest'
import { PLANS, RULESET_A, RULESET_B } from './data'
import { calculateAll, calculateForPlan, diffInputs } from './engine'
import type { QuoteInput } from './types'

const STANDARD_A = RULESET_A.plans.find((p) => p.id === 'standard')!
const STANDARD_B = RULESET_B.plans.find((p) => p.id === 'standard')!

const input = (overrides: Partial<QuoteInput> = {}): QuoteInput => ({
  age: 35,
  regionId: 'east',
  sumInsured: 300000,
  riderIds: [],
  ...overrides,
})

const runA = (i: QuoteInput) => calculateForPlan(i, STANDARD_A, RULESET_A)
const runB = (i: QuoteInput) => calculateForPlan(i, STANDARD_B, RULESET_B)

describe('引擎回归：规则集参数化后结果不变', () => {
  it('默认输入的标准版总价锚定', () => {
    const q = runA(input())
    expect(q.status).toBe('ok')
    // 3×120=360 → 壮年 ×1.4=504 → 华东 ×1.1=554.4
    expect(q.total).toBe(554.4)
    expect(q.steps.map((s) => s.ruleId)).toEqual(['base-standard', 'age-prime', 'region-east'])
  })

  it('calculateAll 返回全部方案', () => {
    expect(calculateAll(input(), RULESET_A)).toHaveLength(PLANS.length)
  })
})

describe('边界值：年龄区间端点（含端点）', () => {
  const totalAt = (age: number) => runA(input({ age })).total

  it('每个分段的上下端点都落在正确区间', () => {
    expect(totalAt(0)).toBe(198) // 未成年 0.5：360×0.5×1.1
    expect(totalAt(17)).toBe(198)
    expect(totalAt(18)).toBe(356.4) // 青年 1.0 + 青年优惠 0.9：360×1.1×0.9
    expect(totalAt(30)).toBe(356.4)
    expect(totalAt(31)).toBe(554.4) // 壮年 1.4，无青年优惠
    expect(totalAt(45)).toBe(554.4)
    expect(totalAt(46)).toBe(792) // 中年 2.0：360×2×1.1
    expect(totalAt(60)).toBe(792)
    expect(totalAt(61)).toBe(1267.2) // 老年 3.2：360×3.2×1.1
    expect(totalAt(70)).toBe(1267.2)
  })

  it('超出投保年龄上限无法投保', () => {
    const q = runA(input({ age: 71 }))
    expect(q.status).toBe('unavailable')
    expect(q.messages[0]).toContain('0–70')
  })

  it('规则集 B 放宽到 75 岁：75 可投、76 不可投', () => {
    const at75 = runB(input({ age: 75 }))
    expect(at75.status).toBe('ok')
    // 3×115=345 → 老年 ×3.2=1104 → 华东 ×1.08=1192.32 → 线上优惠 ×0.98=1168.47
    expect(at75.total).toBe(1168.47)
    expect(runB(input({ age: 76 })).status).toBe('unavailable')
  })
})

describe('边界值：折扣门槛与附加险适用范围', () => {
  it('大额保单优惠：保额恰好 50 万命中，49 万不命中', () => {
    const hit = runA(input({ sumInsured: 500000 }))
    expect(hit.steps.some((s) => s.ruleId === 'discount-big-policy')).toBe(true)
    // 5×120=600 → ×1.4=840 → ×1.1=924 → ×0.95=877.8
    expect(hit.total).toBe(877.8)

    const miss = runA(input({ sumInsured: 490000 }))
    expect(miss.steps.some((s) => s.ruleId === 'discount-big-policy')).toBe(false)
  })

  it('规则集 B 的大额门槛降为 40 万', () => {
    const q = runB(input({ sumInsured: 400000 }))
    expect(q.steps.some((s) => s.ruleId === 'discount-big-policy')).toBe(true)
    expect(runA(input({ sumInsured: 400000 })).steps.some((s) => s.ruleId === 'discount-big-policy')).toBe(false)
  })

  it('意外住院津贴：18 与 60 岁可投，17 与 61 岁排除', () => {
    const rider = 'hospital-allowance'
    const kept = (age: number) =>
      runA(input({ age, riderIds: [rider] })).steps.some((s) => s.ruleId === `rider-${rider}`)
    const excluded = (age: number) =>
      runA(input({ age, riderIds: [rider] })).excluded.some((e) => e.ruleId === `rider-${rider}`)
    expect(kept(18)).toBe(true)
    expect(kept(60)).toBe(true)
    expect(excluded(17)).toBe(true)
    expect(excluded(61)).toBe(true)
  })

  it('保费豁免：保额恰好 30 万命中，不足则排除', () => {
    const kept = runA(input({ riderIds: ['waiver'] }))
    expect(kept.steps.some((s) => s.ruleId === 'rider-waiver')).toBe(true)

    const excluded = runA(input({ sumInsured: 100000, riderIds: ['waiver'] }))
    expect(excluded.excluded).toHaveLength(1)
    expect(excluded.excluded[0].reason).toContain('保额')
  })
})

describe('互斥规则：按优先级取舍并说明', () => {
  it('同时勾选两个互斥医疗险，保留优先级高者', () => {
    const q = runA(input({ riderIds: ['acc-medical-basic', 'acc-medical-plus'] }))
    // 不限社保（8）> 社保内（5）：保留 plus
    expect(q.steps.some((s) => s.ruleId === 'rider-acc-medical-plus')).toBe(true)
    expect(q.steps.some((s) => s.ruleId === 'rider-acc-medical-basic')).toBe(false)

    expect(q.excluded).toHaveLength(1)
    expect(q.excluded[0].ruleId).toBe('rider-acc-medical-basic')
    expect(q.excluded[0].reason).toContain('互斥')
    expect(q.excluded[0].reason).toContain('5 < 8')
    expect(q.messages.some((m) => m.includes('互斥'))).toBe(true)
    // 554.4 + 3×38 = 668.4
    expect(q.total).toBe(668.4)
  })
})

describe('输入完整性', () => {
  it('缺年龄 → incomplete 并列出缺失项', () => {
    const q = runA(input({ age: null }))
    expect(q.status).toBe('incomplete')
    expect(q.missing).toEqual(['年龄'])
  })

  it('全部缺失 → 列出全部缺失项', () => {
    const q = runA({ age: null, regionId: null, sumInsured: null, riderIds: [] })
    expect(q.status).toBe('incomplete')
    expect(q.missing).toEqual(['年龄', '地区', '保障额度'])
  })
})

describe('diffInputs', () => {
  it('报告字段级变化', () => {
    const changes = diffInputs(input(), input({ age: 40, riderIds: ['waiver'] }), RULESET_A)
    expect(changes).toContain('年龄：35 → 40')
    expect(changes.some((c) => c.includes('附加险新增') && c.includes('保费豁免'))).toBe(true)
  })
})
