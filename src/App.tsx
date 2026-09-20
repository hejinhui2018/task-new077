import { useEffect, useMemo, useReducer, useState } from 'react'
import ComparePanel, { type PlanSummary } from './components/ComparePanel'
import ExplainPanel from './components/ExplainPanel'
import InputPanel from './components/InputPanel'
import PlanList from './components/PlanList'
import { compareQuotes } from './engine/compare'
import { DEFAULT_INPUT, RULESET_A, RULESET_B } from './engine/data'
import { calculateAll, diffInputs } from './engine/engine'
import {
  compareHistoryReducer,
  initCompareHistory,
  restoreCompareHistory,
  type CompareHistory,
  type CompareSnapshot,
} from './state/compareHistory'
import { historyReducer, initHistory, restoreHistory, sameInput, type HistoryState } from './state/history'
import { loadJSON, saveJSON } from './state/persistence'

const INPUT_STORAGE_KEY = 'policylens.input-history.v1'
const COMPARE_STORAGE_KEY = 'policylens.compare-history.v1'

export default function App() {
  // 初始状态优先从 localStorage 恢复（刷新恢复），失败则回退默认值
  const [initialHistory] = useState<HistoryState>(
    () => loadJSON(INPUT_STORAGE_KEY, restoreHistory) ?? initHistory(DEFAULT_INPUT),
  )
  const [history, dispatch] = useReducer(historyReducer, initialHistory)
  const [initialCompare] = useState<CompareHistory>(
    () => loadJSON(COMPARE_STORAGE_KEY, restoreCompareHistory) ?? initCompareHistory(),
  )
  const [compare, dispatchCompare] = useReducer(compareHistoryReducer, initialCompare)
  const [selectedPlanId, setSelectedPlanId] = useState('standard')

  useEffect(() => saveJSON(INPUT_STORAGE_KEY, history), [history])
  useEffect(() => saveJSON(COMPARE_STORAGE_KEY, compare), [compare])

  // ---------- 单规则集试算（现行规则 A）：任何字段变化都会触发重算 ----------
  const quotes = useMemo(() => calculateAll(history.present, RULESET_A), [history.present])
  const prevInput = history.past.length > 0 ? history.past[history.past.length - 1] : null
  const prevQuotes = useMemo(() => (prevInput ? calculateAll(prevInput, RULESET_A) : null), [prevInput])
  const changes = useMemo(
    () => (prevInput ? diffInputs(prevInput, history.present, RULESET_A) : []),
    [prevInput, history.present],
  )

  const selectedQuote = quotes.find((q) => q.planId === selectedPlanId) ?? quotes[0]
  const prevSelectedQuote = prevQuotes?.find((q) => q.planId === selectedQuote.planId) ?? null

  // ---------- 规则方案对照：同一输入快照 × 两套独立规则集 ----------
  const { lockedInput, baseFirst, snapshots, replay } = compare.present
  const compareInput = lockedInput ?? history.present
  const baseSet = baseFirst ? RULESET_A : RULESET_B
  const compareSet = baseFirst ? RULESET_B : RULESET_A

  const baseQuotes = useMemo(() => calculateAll(compareInput, baseSet), [compareInput, baseSet])
  const compareSideQuotes = useMemo(() => calculateAll(compareInput, compareSet), [compareInput, compareSet])

  const baseQuote = baseQuotes.find((q) => q.planId === selectedQuote.planId) ?? null
  const compareSideQuote = compareSideQuotes.find((q) => q.planId === selectedQuote.planId) ?? null
  const comparison = useMemo(
    () => (baseQuote && compareSideQuote ? compareQuotes(baseQuote, compareSideQuote) : null),
    [baseQuote, compareSideQuote],
  )

  const planSummaries: PlanSummary[] = baseQuotes.flatMap((bq) => {
    const cq = compareSideQuotes.find((q) => q.planId === bq.planId)
    return cq
      ? [
          {
            planId: bq.planId,
            planName: bq.planName,
            statusBase: bq.status,
            statusCompare: cq.status,
            totalBase: bq.total,
            totalCompare: cq.total,
          },
        ]
      : []
  })

  const liveDrifted = lockedInput !== null && !sameInput(lockedInput, history.present)

  const handleSaveSnapshot = () => {
    if (!comparison) return
    const region = baseSet.regions.find((r) => r.id === compareInput.regionId)?.name ?? '未选地区'
    const sum = compareInput.sumInsured !== null ? `${compareInput.sumInsured / 10000} 万` : '未选额度'
    const snapshot: CompareSnapshot = {
      id: `snap-${Date.now()}`,
      label: `${compareInput.age ?? '？'} 岁 · ${region} · ${sum} · ${baseSet.id}→${compareSet.id} · ${selectedQuote.planName}`,
      createdAt: Date.now(),
      input: { ...compareInput, riderIds: [...compareInput.riderIds] },
      baseSetId: baseSet.id,
      compareSetId: compareSet.id,
      baseFirst,
      planId: selectedQuote.planId,
      result: comparison,
    }
    dispatchCompare({ type: 'saveSnapshot', snapshot })
  }

  const handleLoadSnapshot = (id: string) => {
    const snap = snapshots.find((s) => s.id === id)
    if (!snap) return
    dispatchCompare({ type: 'loadSnapshot', id })
    dispatch({ type: 'update', next: { ...snap.input, riderIds: [...snap.input.riderIds] } })
    setSelectedPlanId(snap.planId)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>PolicyLens · 保费方案试算</h1>
          <p className="subtitle">修改任意条件即重新试算，并解释价格由哪些规则叠加而来</p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={history.past.length === 0}>
            ↩ 撤销
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={history.future.length === 0}>
            ↪ 重做
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'reset', initial: DEFAULT_INPUT })}
            disabled={sameInput(history.present, DEFAULT_INPUT)}
          >
            恢复默认
          </button>
        </div>
      </header>

      <main className="layout">
        <InputPanel input={history.present} onChange={(next) => dispatch({ type: 'update', next })} />
        <PlanList
          quotes={quotes}
          prevQuotes={prevQuotes}
          selectedPlanId={selectedQuote.planId}
          onSelect={setSelectedPlanId}
        />
        <ExplainPanel quote={selectedQuote} prevQuote={prevSelectedQuote} changes={changes} />
        <ComparePanel
          baseSetName={baseSet.name}
          compareSetName={compareSet.name}
          locked={lockedInput !== null}
          lockedInput={lockedInput}
          liveDrifted={liveDrifted}
          baseQuote={baseQuote}
          compareQuote={compareSideQuote}
          comparison={comparison}
          summaries={planSummaries}
          selectedPlanId={selectedQuote.planId}
          onSelectPlan={setSelectedPlanId}
          onToggleLock={() => dispatchCompare({ type: 'toggleLock', currentInput: history.present })}
          onSwap={() => dispatchCompare({ type: 'swapBaseline' })}
          canUndo={compare.past.length > 0}
          canRedo={compare.future.length > 0}
          onUndo={() => dispatchCompare({ type: 'undo' })}
          onRedo={() => dispatchCompare({ type: 'redo' })}
          canSaveSnapshot={comparison !== null}
          onSaveSnapshot={handleSaveSnapshot}
          snapshots={snapshots}
          onLoadSnapshot={handleLoadSnapshot}
          onDeleteSnapshot={(id) => dispatchCompare({ type: 'deleteSnapshot', id })}
          replay={replay}
          onReplayTo={(key) => dispatchCompare({ type: 'replayTo', key })}
          onReplayMove={(delta) =>
            dispatchCompare({ type: 'replayMove', delta, keys: comparison?.steps.map((s) => s.key) ?? [] })
          }
          onReplayClose={() => dispatchCompare({ type: 'replayClose' })}
        />
      </main>

      <footer className="app-footer">规则与费率均为浏览器本地内置数据，仅用于演示。</footer>
    </div>
  )
}
