import { describe, expect, it } from 'vitest'
import {
  compareHistoryReducer as reduce,
  initCompareHistory,
  restoreCompareHistory,
  type CompareSnapshot,
} from './compareHistory'
import { loadJSON, saveJSON } from './persistence'
import type { QuoteInput } from '../engine/types'

const INPUT: QuoteInput = { age: 35, regionId: 'east', sumInsured: 300000, riderIds: ['r1'] }

const mkSnap = (id: string, overrides: Partial<CompareSnapshot> = {}): CompareSnapshot => ({
  id,
  label: id,
  createdAt: 1,
  input: { age: 35, regionId: 'east', sumInsured: 300000, riderIds: [] },
  baseSetId: 'A',
  compareSetId: 'B',
  baseFirst: true,
  planId: 'standard',
  result: {} as CompareSnapshot['result'],
  ...overrides,
})

describe('锁定输入', () => {
  it('锁定时深拷贝当前输入，之后的修改不影响快照', () => {
    const src: QuoteInput = { ...INPUT, riderIds: ['r1'] }
    const h = reduce(initCompareHistory(), { type: 'toggleLock', currentInput: src })
    src.riderIds.push('r2')
    expect(h.present.lockedInput?.riderIds).toEqual(['r1'])
    expect(h.present.lockedInput).not.toBe(src)
  })

  it('再次切换解除锁定；撤销 / 重做在锁定与解锁间往返', () => {
    let h = reduce(initCompareHistory(), { type: 'toggleLock', currentInput: INPUT })
    h = reduce(h, { type: 'toggleLock' })
    expect(h.present.lockedInput).toBeNull()

    h = reduce(h, { type: 'undo' })
    expect(h.present.lockedInput).toEqual(INPUT)
    h = reduce(h, { type: 'undo' })
    expect(h.present.lockedInput).toBeNull()
    h = reduce(h, { type: 'redo' })
    expect(h.present.lockedInput).toEqual(INPUT)
  })
})

describe('交换基线', () => {
  it('交换方向并可撤销', () => {
    let h = reduce(initCompareHistory(), { type: 'swapBaseline' })
    expect(h.present.baseFirst).toBe(false)
    h = reduce(h, { type: 'undo' })
    expect(h.present.baseFirst).toBe(true)
    h = reduce(h, { type: 'redo' })
    expect(h.present.baseFirst).toBe(false)
  })
})

describe('比较快照', () => {
  it('保存快照可撤销，删除也可撤销', () => {
    let h = reduce(initCompareHistory(), { type: 'saveSnapshot', snapshot: mkSnap('s1') })
    expect(h.present.snapshots).toHaveLength(1)

    h = reduce(h, { type: 'deleteSnapshot', id: 's1' })
    expect(h.present.snapshots).toHaveLength(0)

    h = reduce(h, { type: 'undo' })
    expect(h.present.snapshots).toHaveLength(1)

    h = reduce(h, { type: 'undo' })
    expect(h.present.snapshots).toHaveLength(0)
  })

  it('重复比较（同输入、同方向、同方案）不重复保存', () => {
    let h = reduce(initCompareHistory(), { type: 'saveSnapshot', snapshot: mkSnap('s1') })
    const before = h
    h = reduce(h, { type: 'saveSnapshot', snapshot: mkSnap('s2') })
    expect(h).toBe(before) // 完全相同的比较：状态不变
    expect(h.present.snapshots).toHaveLength(1)

    // 换了方案或方向则是新的比较
    h = reduce(h, { type: 'saveSnapshot', snapshot: mkSnap('s3', { planId: 'premium' }) })
    h = reduce(h, { type: 'saveSnapshot', snapshot: mkSnap('s4', { baseSetId: 'B', compareSetId: 'A', baseFirst: false }) })
    expect(h.present.snapshots).toHaveLength(3)
  })

  it('载入快照：恢复锁定输入与对照方向', () => {
    const snap = mkSnap('s1', {
      input: { age: 50, regionId: 'west', sumInsured: 500000, riderIds: ['waiver'] },
      baseFirst: false,
    })
    let h = reduce(initCompareHistory(), { type: 'saveSnapshot', snapshot: snap })
    h = reduce(h, { type: 'loadSnapshot', id: 's1' })
    expect(h.present.lockedInput).toEqual(snap.input)
    expect(h.present.baseFirst).toBe(false)
    expect(h.present.replay).toBeNull()
  })
})

describe('从差异节点重放', () => {
  const keys = ['a', 'b', 'c']

  it('定位到差异节点后可前后步进，边界处钳制', () => {
    let h = reduce(initCompareHistory(), { type: 'replayTo', key: 'b' })
    expect(h.present.replay).toEqual({ key: 'b' })

    h = reduce(h, { type: 'replayMove', delta: 1, keys })
    expect(h.present.replay?.key).toBe('c')
    h = reduce(h, { type: 'replayMove', delta: 1, keys })
    expect(h.present.replay?.key).toBe('c') // 已到末尾
    h = reduce(h, { type: 'replayMove', delta: -1, keys })
    expect(h.present.replay?.key).toBe('b')
  })

  it('重放不进入撤销历史；交换基线会结束重放', () => {
    let h = reduce(initCompareHistory(), { type: 'replayTo', key: 'a' })
    expect(h.past).toHaveLength(0)

    h = reduce(h, { type: 'swapBaseline' })
    expect(h.present.replay).toBeNull()
    expect(h.past).toHaveLength(1) // 只有交换进入历史
  })

  it('结束重放', () => {
    let h = reduce(initCompareHistory(), { type: 'replayTo', key: 'a' })
    h = reduce(h, { type: 'replayClose' })
    expect(h.present.replay).toBeNull()
  })
})

describe('历史上限', () => {
  it('撤销栈最多保留 50 条', () => {
    let h = initCompareHistory()
    for (let i = 0; i < 60; i++) h = reduce(h, { type: 'swapBaseline' })
    expect(h.past).toHaveLength(50)
  })
})

describe('刷新恢复', () => {
  it('序列化后可完整恢复（含快照与撤销栈）', () => {
    let h = reduce(initCompareHistory(), { type: 'toggleLock', currentInput: INPUT })
    h = reduce(h, { type: 'saveSnapshot', snapshot: mkSnap('s1') })
    h = reduce(h, { type: 'replayTo', key: 'discount-online' })

    const revived = restoreCompareHistory(JSON.parse(JSON.stringify(h)))
    expect(revived).toEqual(h)
  })

  it('结构不合法时返回 null（回退初始状态）', () => {
    expect(restoreCompareHistory(null)).toBeNull()
    expect(restoreCompareHistory('junk')).toBeNull()
    expect(restoreCompareHistory({ past: [], present: { lockedInput: 1 }, future: [] })).toBeNull()
    expect(
      restoreCompareHistory({
        past: [],
        present: { lockedInput: null, baseFirst: true, snapshots: [{ bad: true }], replay: null },
        future: [],
      }),
    ).toBeNull()
  })

  it('非浏览器环境下持久化静默降级', () => {
    expect(loadJSON('nothing-here', (v) => v)).toBeNull()
    expect(() => saveJSON('k', { a: 1 })).not.toThrow()
  })
})
