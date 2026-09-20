import { describe, expect, it } from 'vitest'
import { defaultWorkspace, initHistory } from './history'
import { parseWorkspace, serializeWorkspace, type PersistedWorkspace } from './persistence'

const sample = (): PersistedWorkspace => ({
  version: 1,
  history: initHistory(defaultWorkspace()),
  mode: 'compare',
  selectedPlanId: 'premium',
  inputLocked: true,
  snapshots: [
    {
      id: 'snap-1',
      name: '测试快照',
      createdAt: '2026-09-20T08:00:00.000Z',
      state: defaultWorkspace(),
      selectedPlanId: 'basic',
    },
  ],
})

describe('持久化 · 刷新恢复', () => {
  it('序列化后可完整还原（含历史、模式、锁定、快照）', () => {
    const p = sample()
    const restored = parseWorkspace(serializeWorkspace(p))
    expect(restored).toEqual(p)
  })

  it('空内容 / 非法 JSON / 版本不符 / 结构缺失都返回 null', () => {
    expect(parseWorkspace(null)).toBeNull()
    expect(parseWorkspace('')).toBeNull()
    expect(parseWorkspace('not-json{')).toBeNull()
    expect(parseWorkspace(JSON.stringify({ version: 2 }))).toBeNull()
    expect(parseWorkspace(JSON.stringify({ version: 1 }))).toBeNull()
    expect(
      parseWorkspace(JSON.stringify({ version: 1, history: { past: [], future: [] } })),
    ).toBeNull()
  })

  it('可选字段缺失时回退到安全默认值', () => {
    const minimal = {
      version: 1,
      history: initHistory(defaultWorkspace()),
    }
    const restored = parseWorkspace(JSON.stringify(minimal))
    expect(restored).not.toBeNull()
    expect(restored!.mode).toBe('calc')
    expect(restored!.inputLocked).toBe(false)
    expect(restored!.snapshots).toEqual([])
    expect(restored!.selectedPlanId).toBe('standard')
  })
})
