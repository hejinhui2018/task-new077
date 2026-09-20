import { describe, expect, it } from 'vitest'
import { historyReducer as reduce, initHistory, restoreHistory, sameInput } from './history'
import type { QuoteInput } from '../engine/types'

const BASE: QuoteInput = { age: 35, regionId: 'east', sumInsured: 300000, riderIds: [] }

describe('sameInput', () => {
  it('附加险顺序不同仍视为同一输入', () => {
    expect(sameInput({ ...BASE, riderIds: ['a', 'b'] }, { ...BASE, riderIds: ['b', 'a'] })).toBe(true)
  })

  it('任一字段不同则不同', () => {
    expect(sameInput(BASE, { ...BASE, age: 36 })).toBe(false)
    expect(sameInput(BASE, { ...BASE, riderIds: ['a'] })).toBe(false)
  })
})

describe('输入历史', () => {
  it('update 推入历史并清空重做栈；undo/redo 往返', () => {
    let h = reduce(initHistory(BASE), { type: 'update', next: { ...BASE, age: 40 } })
    h = reduce(h, { type: 'update', next: { ...BASE, age: 50 } })
    expect(h.present.age).toBe(50)
    expect(h.past).toHaveLength(2)

    h = reduce(h, { type: 'undo' })
    expect(h.present.age).toBe(40)
    h = reduce(h, { type: 'redo' })
    expect(h.present.age).toBe(50)
  })

  it('相同输入的 update 不产生历史', () => {
    const h0 = initHistory(BASE)
    expect(reduce(h0, { type: 'update', next: { ...BASE } })).toBe(h0)
  })
})

describe('刷新恢复', () => {
  it('合法结构可恢复', () => {
    const h = reduce(initHistory(BASE), { type: 'update', next: { ...BASE, age: 40 } })
    expect(restoreHistory(JSON.parse(JSON.stringify(h)))).toEqual(h)
  })

  it('结构不合法返回 null', () => {
    expect(restoreHistory(null)).toBeNull()
    expect(restoreHistory({ past: [], present: { age: 'x' }, future: [] })).toBeNull()
    expect(
      restoreHistory({ past: [], present: { ...BASE, riderIds: 'not-array' }, future: [] }),
    ).toBeNull()
  })
})
