import type { RuleEntity, RulePair, RuleSetDiff } from '../engine/compare'
import { entityKindLabel } from '../engine/compare'

interface Props {
  diff: RuleSetDiff
  explanations: string[]
  nameA: string
  nameB: string
}

function EntityLine({ entity, side }: { entity: RuleEntity; side: string }) {
  return (
    <li className="entity-line">
      <span className={`kind-badge ${entity.kind}`}>{entityKindLabel(entity.kind)}</span>
      <span className="entity-name">{entity.name}</span>
      <span className="entity-fields">
        {entity.fields.map((f) => `${f.label} ${f.value}`).join('；')}
        {side && `（${side}）`}
      </span>
    </li>
  )
}

function PairLine({ pair }: { pair: RulePair }) {
  return (
    <li className="entity-line">
      <span className={`kind-badge ${pair.after.kind}`}>{entityKindLabel(pair.after.kind)}</span>
      <span className="entity-name">{pair.after.name}</span>
      <span className="entity-fields">
        {pair.changes.length > 0
          ? pair.changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join('；')
          : '结构一致'}
      </span>
    </li>
  )
}

export default function RuleDiffPanel({ diff, explanations, nameA, nameB }: Props) {
  const total =
    diff.added.length + diff.removed.length + diff.modified.length + diff.priorityChanged.length + diff.unchanged.length

  return (
    <div className="rule-diff-panel">
      <div className="diff-summary">
        <span className="chip">共 {total} 条规则</span>
        <span className="chip ok">等价 {diff.unchanged.length}</span>
        <span className="chip modified">参数变化 {diff.modified.length}</span>
        <span className="chip priority">优先级变化 {diff.priorityChanged.length}</span>
        <span className="chip added">新增 {diff.added.length}</span>
        <span className="chip removed">移除 {diff.removed.length}</span>
      </div>

      <div className="explain-lines">
        <h3>差异解释（{nameA} → {nameB}）</h3>
        <ul>
          {explanations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {diff.modified.length > 0 && (
        <div className="diff-group">
          <h4>参数变化（按稳定 id 配对，非名称猜测）</h4>
          <ul>
            {diff.modified.map((p) => (
              <PairLine key={p.before.key} pair={p} />
            ))}
          </ul>
        </div>
      )}

      {diff.priorityChanged.length > 0 && (
        <div className="diff-group">
          <h4>优先级变化（结构等价）</h4>
          <ul>
            {diff.priorityChanged.map((p) => (
              <PairLine key={p.before.key} pair={p} />
            ))}
          </ul>
        </div>
      )}

      {diff.added.length > 0 && (
        <div className="diff-group">
          <h4>新增（仅 {nameB}）</h4>
          <ul>
            {diff.added.map((e) => (
              <EntityLine key={e.key} entity={e} side="" />
            ))}
          </ul>
        </div>
      )}

      {diff.removed.length > 0 && (
        <div className="diff-group">
          <h4>移除（仅 {nameA}）</h4>
          <ul>
            {diff.removed.map((e) => (
              <EntityLine key={e.key} entity={e} side="" />
            ))}
          </ul>
        </div>
      )}

      {diff.unchanged.length > 0 && (
        <details className="diff-group collapsed">
          <summary>等价规则（{diff.unchanged.length} 条，结构完全一致）</summary>
          <ul>
            {diff.unchanged.map((p) => (
              <PairLine key={p.before.key} pair={p} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
