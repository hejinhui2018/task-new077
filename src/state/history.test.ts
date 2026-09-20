import { describe, expect, it } from 'vitest'
import {
  defaultWorkspace,
  historyReducer,
  initHistory,
  sameWorkspace,
  type WorkspaceState,
} from './history'
import { cloneRuleset } from '../engine/ruleset'

const ws = (): WorkspaceState => defaultWorkspace()

describe('工作区历史 · 撤销 / 重做', () => {
  it('输入修改可撤销、可重做', () => {
    let h = initHistory(ws())
    const older = h.present.input
    h = historyReducer(h, { type: 'updateInput', next: { ...h.present.input, age: 40 } })
    expect(h.present.input.age).toBe(40)
    expect(h.past).toHaveLength(1)

    h = historyReducer(h, { type: 'undo' })
    expect(h.present.input).toEqual(older)
    expect(h.future).toHaveLength(1)

    h = historyReducer(h, { type: 'redo' })
    expect(h.present.input.age).toBe(40)
  })

  it('规则集编辑只影响目标侧，且可撤销', () => {
    let h = initHistory(ws())
    const edited = cloneRuleset(h.present.ruleSets.b)
    edited.discounts[0].factor = 0.8
    h = historyReducer(h, { type: 'updateRuleSet', side: 'b', next: edited })
    expect(h.present.ruleSets.b.discounts[0].factor).toBe(0.8)
    expect(h.present.ruleSets.a.discounts[0].factor).not.toBe(0.8)

    h = historyReducer(h, { type: 'undo' })
    expect(h.present.ruleSets.b.discounts[0].factor).not.toBe(0.8)
  })

  it('交换基线：a/b 互换，且可撤销', () => {
    let h = initHistory(ws())
    const a0 = h.present.ruleSets.a
    const b0 = h.present.ruleSets.b
    h = historyReducer(h, { type: 'swapRuleSets' })
    expect(h.present.ruleSets.a).toEqual(b0)
    expect(h.present.ruleSets.b).toEqual(a0)

    h = historyReducer(h, { type: 'undo' })
    expect(h.present.ruleSets.a).toEqual(a0)
    expect(h.present.ruleSets.b).toEqual(b0)
  })

  it('载入快照（replace）可撤销', () => {
    let h = initHistory(ws())
    const snapshotState: WorkspaceState = {
      input: { age: 50, regionId: 'south', sumInsured: 500000, riderIds: ['waiver'] },
      ruleSets: h.present.ruleSets,
    }
    h = historyReducer(h, { type: 'replace', next: snapshotState })
    expect(h.present.input.age).toBe(50)
    h = historyReducer(h, { type: 'undo' })
    expect(h.present.input.age).not.toBe(50)
  })

  it('相同内容不产生新历史（幂等）', () => {
    const h0 = initHistory(ws())
    const h1 = historyReducer(h0, { type: 'updateInput', next: { ...h0.present.input } })
    expect(h1).toBe(h0)
    const h2 = historyReducer(h0, { type: 'updateRuleSet', side: 'a', next: h0.present.ruleSets.a })
    expect(h2).toBe(h0)
  })

  it('历史上限 50 条', () => {
    let h = initHistory(ws())
    for (let i = 1; i <= 60; i += 1) {
      h = historyReducer(h, { type: 'updateInput', next: { ...h.present.input, age: i } })
    }
    expect(h.past.length).toBeLessThanOrEqual(50)
    expect(h.present.input.age).toBe(60)
  })

  it('sameWorkspace 深度比较输入与两套规则集', () => {
    const w1 = ws()
    const w2 = ws()
    expect(sameWorkspace(w1, w2)).toBe(true)
    w2.ruleSets.b.discounts[0].factor = 0.5
    expect(sameWorkspace(w1, w2)).toBe(false)
  })
})
