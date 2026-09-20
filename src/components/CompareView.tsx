import { useMemo, useState } from 'react'
import { buildPropagation, diffRuleSets, explainComparison } from '../engine/compare'
import { calculateForPlan } from '../engine/engine'
import { fmtWan } from '../engine/format'
import type { RuleSet } from '../engine/ruleset'
import type { QuoteInput } from '../engine/types'
import type { CompareSnapshot } from '../state/persistence'
import type { RuleSetPair } from '../state/history'
import PropagationTable from './PropagationTable'
import RuleDiffPanel from './RuleDiffPanel'
import RuleSetEditor from './RuleSetEditor'

interface Props {
  input: QuoteInput
  ruleSets: RuleSetPair
  selectedPlanId: string
  onSelectPlan: (planId: string) => void
  inputLocked: boolean
  onToggleLock: () => void
  onRuleSetChange: (side: 'a' | 'b', next: RuleSet) => void
  onSwap: () => void
  onResetRuleSets: () => void
  snapshots: CompareSnapshot[]
  onSaveSnapshot: (name: string) => void
  onLoadSnapshot: (id: string) => void
  onDeleteSnapshot: (id: string) => void
}

function inputSummary(input: QuoteInput, ruleset: RuleSet): string {
  const parts: string[] = []
  parts.push(input.age === null ? '年龄未填' : `${input.age} 岁`)
  parts.push(ruleset.regions.find((r) => r.id === input.regionId)?.name ?? '地区未选')
  parts.push(input.sumInsured === null ? '额度未选' : fmtWan(input.sumInsured))
  parts.push(`附加险 ${input.riderIds.length} 项`)
  return parts.join(' · ')
}

export default function CompareView({
  input,
  ruleSets,
  selectedPlanId,
  onSelectPlan,
  inputLocked,
  onToggleLock,
  onRuleSetChange,
  onSwap,
  onResetRuleSets,
  snapshots,
  onSaveSnapshot,
  onLoadSnapshot,
  onDeleteSnapshot,
}: Props) {
  const [editSide, setEditSide] = useState<'a' | 'b'>('b')
  const [snapshotName, setSnapshotName] = useState('')

  const { a, b } = ruleSets
  const diff = useMemo(() => diffRuleSets(a, b), [a, b])

  const planA = a.plans.find((p) => p.id === selectedPlanId) ?? null
  const planB = b.plans.find((p) => p.id === selectedPlanId) ?? null
  const quoteA = useMemo(() => (planA ? calculateForPlan(input, planA, a) : null), [input, planA, a])
  const quoteB = useMemo(() => (planB ? calculateForPlan(input, planB, b) : null), [input, planB, b])

  const rows = useMemo(
    () => (quoteA && quoteB ? buildPropagation(quoteA, quoteB, diff) : []),
    [quoteA, quoteB, diff],
  )
  const explanations = useMemo(
    () => (quoteA && quoteB ? explainComparison(diff, rows, quoteA, quoteB) : []),
    [diff, rows, quoteA, quoteB],
  )

  const saveSnapshot = () => {
    onSaveSnapshot(snapshotName)
    setSnapshotName('')
  }

  return (
    <main className="compare-layout">
      <div className="compare-toolbar panel">
        <div className="toolbar-group">
          <span className="toolbar-label">对照方案</span>
          <span className="seg-buttons">
            {a.plans.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === selectedPlanId ? 'active' : ''}
                onClick={() => onSelectPlan(p.id)}
              >
                {p.name}
              </button>
            ))}
          </span>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">输入快照</span>
          <span className={`snapshot-chip${inputLocked ? ' locked' : ''}`}>
            {inputLocked ? '🔒' : '🔓'} {inputSummary(input, a)}
          </span>
          <button type="button" onClick={onToggleLock}>
            {inputLocked ? '解锁输入' : '锁定输入'}
          </button>
        </div>

        <div className="toolbar-group">
          <button type="button" onClick={onSwap} title="交换基线侧与候选侧">
            ⇄ 交换基线
          </button>
          <button type="button" onClick={onResetRuleSets}>
            恢复默认规则
          </button>
        </div>

        <div className="toolbar-group snapshot-group">
          <input
            type="text"
            placeholder="快照名称（可空）"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
          />
          <button type="button" onClick={saveSnapshot}>
            保存对照快照
          </button>
          {snapshots.length > 0 && (
            <ul className="snapshot-list">
              {snapshots.map((s) => (
                <li key={s.id}>
                  <span className="snapshot-name" title={new Date(s.createdAt).toLocaleString('zh-CN')}>
                    {s.name}
                  </span>
                  <button type="button" className="link-btn" onClick={() => onLoadSnapshot(s.id)}>
                    载入
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => onDeleteSnapshot(s.id)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="panel editor-panel">
        <div className="steps-header">
          <h2>规则集编辑</h2>
          <span className="seg-buttons">
            <button type="button" className={editSide === 'a' ? 'active' : ''} onClick={() => setEditSide('a')}>
              基线 · {a.name}
            </button>
            <button type="button" className={editSide === 'b' ? 'active' : ''} onClick={() => setEditSide('b')}>
              候选 · {b.name}
            </button>
          </span>
        </div>
        <div className="editor-actions">
          <button type="button" className="link-btn" onClick={() => onRuleSetChange('b', JSON.parse(JSON.stringify(a)) as RuleSet)}>
            复制 {a.name} → 候选侧
          </button>
          <button type="button" className="link-btn" onClick={() => onRuleSetChange('a', JSON.parse(JSON.stringify(b)) as RuleSet)}>
            复制 {b.name} → 基线侧
          </button>
        </div>
        <RuleSetEditor ruleset={editSide === 'a' ? a : b} onChange={(next) => onRuleSetChange(editSide, next)} />
      </section>

      <section className="panel diff-panel">
        <h2>规则对照</h2>
        <RuleDiffPanel diff={diff} explanations={explanations} nameA={a.name} nameB={b.name} />
      </section>

      <div className="propagation-area">
        {quoteA && quoteB ? (
          <PropagationTable planName={planA?.name ?? selectedPlanId} nameA={a.name} nameB={b.name} quoteA={quoteA} quoteB={quoteB} rows={rows} />
        ) : (
          <section className="panel propagation-panel">
            <h2>影响传播</h2>
            <p className="muted">
              {!planA ? `基线「${a.name}」中不存在方案 ${selectedPlanId}` : `候选「${b.name}」中不存在方案 ${selectedPlanId}`}，无法对照。
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
