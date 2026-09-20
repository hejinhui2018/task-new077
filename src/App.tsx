import { useEffect, useMemo, useReducer, useState } from 'react'
import CompareView from './components/CompareView'
import ExplainPanel from './components/ExplainPanel'
import InputPanel from './components/InputPanel'
import PlanList from './components/PlanList'
import { calculateAll, diffInputs } from './engine/engine'
import {
  defaultWorkspace,
  historyReducer,
  initHistory,
  sameWorkspace,
  type WorkspaceState,
} from './state/history'
import { loadWorkspace, saveWorkspace, type CompareSnapshot } from './state/persistence'

export default function App() {
  // 刷新恢复：启动时读取一次本地持久化内容
  const [persisted] = useState(() => loadWorkspace())
  const [history, dispatch] = useReducer(historyReducer, persisted, (p) =>
    p ? p.history : initHistory(defaultWorkspace()),
  )
  const [mode, setMode] = useState<'calc' | 'compare'>(persisted?.mode ?? 'calc')
  const [selectedPlanId, setSelectedPlanId] = useState(persisted?.selectedPlanId ?? 'standard')
  const [inputLocked, setInputLocked] = useState(persisted?.inputLocked ?? false)
  const [snapshots, setSnapshots] = useState<CompareSnapshot[]>(persisted?.snapshots ?? [])

  useEffect(() => {
    saveWorkspace({ version: 1, history, mode, selectedPlanId, inputLocked, snapshots })
  }, [history, mode, selectedPlanId, inputLocked, snapshots])

  const { input, ruleSets } = history.present

  // 试算页始终使用基线规则集 A；上一条历史快照即“调整前”
  const quotes = useMemo(() => calculateAll(input, ruleSets.a), [input, ruleSets.a])
  const prevInput = history.past.length > 0 ? history.past[history.past.length - 1].input : null
  const prevQuotes = useMemo(() => (prevInput ? calculateAll(prevInput, ruleSets.a) : null), [prevInput, ruleSets.a])
  const changes = useMemo(
    () => (prevInput ? diffInputs(prevInput, input, ruleSets.a) : []),
    [prevInput, input, ruleSets.a],
  )

  const selectedQuote = quotes.find((q) => q.planId === selectedPlanId) ?? quotes[0]
  const prevSelectedQuote = prevQuotes?.find((q) => q.planId === selectedQuote?.planId) ?? null

  const saveSnapshot = (name: string) => {
    const snapshot: CompareSnapshot = {
      id: `snap-${Date.now().toString(36)}-${snapshots.length}`,
      name: name.trim() || `对照快照 ${snapshots.length + 1}`,
      createdAt: new Date().toISOString(),
      state: history.present,
      selectedPlanId,
    }
    setSnapshots((prev) => [...prev, snapshot])
  }

  const loadSnapshot = (id: string) => {
    const snapshot = snapshots.find((s) => s.id === id)
    if (!snapshot) return
    dispatch({ type: 'replace', next: snapshot.state })
    setSelectedPlanId(snapshot.selectedPlanId)
  }

  const resetAll = () => dispatch({ type: 'reset', initial: defaultWorkspace() })

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>PolicyLens 保费试算</h1>
          <p className="subtitle">同一客户场景下，试算并对照两套规则方案的价格影响</p>
        </div>
        <div className="actions">
          <span className="mode-toggle">
            <button type="button" className={mode === 'calc' ? 'active' : ''} onClick={() => setMode('calc')}>
              试算
            </button>
            <button type="button" className={mode === 'compare' ? 'active' : ''} onClick={() => setMode('compare')}>
              规则对照
            </button>
          </span>
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={history.past.length === 0}>
            ↩ 撤销
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={history.future.length === 0}>
            ↪ 重做
          </button>
          <button type="button" onClick={resetAll} disabled={sameWorkspace(history.present, defaultWorkspace())}>
            恢复默认
          </button>
        </div>
      </header>

      {mode === 'calc' ? (
        <main className="layout">
          <InputPanel
            input={input}
            ruleset={ruleSets.a}
            locked={inputLocked}
            onUnlock={() => setInputLocked(false)}
            onChange={(next) => dispatch({ type: 'updateInput', next })}
          />
          <PlanList
            quotes={quotes}
            prevQuotes={prevQuotes}
            selectedPlanId={selectedQuote?.planId ?? selectedPlanId}
            onSelect={setSelectedPlanId}
          />
          {selectedQuote && <ExplainPanel quote={selectedQuote} prevQuote={prevSelectedQuote} changes={changes} />}
        </main>
      ) : (
        <CompareView
          input={input}
          ruleSets={ruleSets}
          selectedPlanId={selectedPlanId}
          onSelectPlan={setSelectedPlanId}
          inputLocked={inputLocked}
          onToggleLock={() => setInputLocked((v) => !v)}
          onRuleSetChange={(side, next) => dispatch({ type: 'updateRuleSet', side, next })}
          onSwap={() => dispatch({ type: 'swapRuleSets' })}
          onResetRuleSets={() =>
            dispatch({
              type: 'replace',
              next: { ...history.present, ruleSets: defaultWorkspace().ruleSets } satisfies WorkspaceState,
            })
          }
          snapshots={snapshots}
          onSaveSnapshot={saveSnapshot}
          onLoadSnapshot={loadSnapshot}
          onDeleteSnapshot={(id) => setSnapshots((prev) => prev.filter((s) => s.id !== id))}
        />
      )}

      <footer className="app-footer">规则与费率均为浏览器本地内置数据，仅用于演示。</footer>
    </div>
  )
}
