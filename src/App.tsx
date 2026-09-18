import { useMemo, useReducer, useState } from 'react'
import ExplainPanel from './components/ExplainPanel'
import InputPanel from './components/InputPanel'
import PlanList from './components/PlanList'
import { DEFAULT_INPUT } from './engine/data'
import { calculateAll, diffInputs } from './engine/engine'
import { historyReducer, initHistory, sameInput } from './state/history'

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, DEFAULT_INPUT, initHistory)
  const [selectedPlanId, setSelectedPlanId] = useState('standard')

  // 任何字段变化都会触发重算；上一条历史快照即“调整前”
  const quotes = useMemo(() => calculateAll(history.present), [history.present])
  const prevInput = history.past.length > 0 ? history.past[history.past.length - 1] : null
  const prevQuotes = useMemo(() => (prevInput ? calculateAll(prevInput) : null), [prevInput])
  const changes = useMemo(
    () => (prevInput ? diffInputs(prevInput, history.present) : []),
    [prevInput, history.present],
  )

  const selectedQuote = quotes.find((q) => q.planId === selectedPlanId) ?? quotes[0]
  const prevSelectedQuote = prevQuotes?.find((q) => q.planId === selectedQuote.planId) ?? null

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>保费方案试算</h1>
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
      </main>

      <footer className="app-footer">规则与费率均为浏览器本地内置数据，仅用于演示。</footer>
    </div>
  )
}
