import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import App from './App'
import CompareView from './components/CompareView'
import { defaultWorkspace } from './state/history'

describe('渲染冒烟', () => {
  it('试算模式初始渲染不报错', () => {
    const html = renderToString(createElement(App))
    expect(html).toContain('PolicyLens')
    expect(html).toContain('投保条件')
  })

  it('对照视图：默认 A/B 规则集渲染出差异解释与影响传播', () => {
    const ws = defaultWorkspace()
    const html = renderToString(
      createElement(CompareView, {
        input: ws.input,
        ruleSets: ws.ruleSets,
        selectedPlanId: 'standard',
        onSelectPlan: () => {},
        inputLocked: false,
        onToggleLock: () => {},
        onRuleSetChange: () => {},
        onSwap: () => {},
        onResetRuleSets: () => {},
        snapshots: [],
        onSaveSnapshot: () => {},
        onLoadSnapshot: () => {},
        onDeleteSnapshot: () => {},
      }),
    )
    // 默认 B 预置了优先级变化 / 参数变化 / 新增 / 移除，应全部出现在对照结果中
    expect(html).toContain('优先级变化')
    expect(html).toContain('参数变化')
    expect(html).toContain('新增')
    expect(html).toContain('移除')
    expect(html).toContain('影响传播')
    expect(html).toContain('从此重放')
  })
})
