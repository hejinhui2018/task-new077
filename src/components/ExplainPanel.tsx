import { useState } from 'react'
import { diffSteps } from '../engine/engine'
import { fmtDelta, fmtMoney } from '../engine/format'
import type { CalcStep, PlanQuote, RuleKind } from '../engine/types'

interface Props {
  quote: PlanQuote
  prevQuote: PlanQuote | null
  changes: string[]
}

const KIND_LABEL: Record<RuleKind, string> = {
  base: '基础',
  age: '年龄',
  region: '地区',
  discount: '优惠',
  rider: '附加险',
}

const STATUS_LABEL: Record<PlanQuote['status'], string> = {
  ok: '可投保',
  incomplete: '信息不完整',
  unavailable: '无法投保',
}

function StepRow({ step, expanded, onToggle }: { step: CalcStep; expanded: boolean; onToggle: () => void }) {
  return (
    <li className={`step ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="step-head" onClick={onToggle}>
        <span className={`kind-badge ${step.kind}`}>{KIND_LABEL[step.kind]}</span>
        <span className="step-name">{step.ruleName}</span>
        <span className="step-amounts">
          {fmtMoney(step.amountBefore)} → <strong>{fmtMoney(step.amountAfter)}</strong>
        </span>
        <span className="step-caret">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <dl className="step-detail">
          <div>
            <dt>计算说明</dt>
            <dd>{step.detail}</dd>
          </div>
          <div>
            <dt>适用范围</dt>
            <dd>{step.scopeText}</dd>
          </div>
          <div>
            <dt>规则优先级</dt>
            <dd>{step.priority}</dd>
          </div>
          <div>
            <dt>规则 ID</dt>
            <dd>
              <code>{step.ruleId}</code>
            </dd>
          </div>
        </dl>
      )}
    </li>
  )
}

export default function ExplainPanel({ quote, prevQuote, changes }: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allExpanded = quote.steps.length > 0 && quote.steps.every((s) => expanded.has(s.ruleId))
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(quote.steps.map((s) => s.ruleId)))

  const stepDiff = prevQuote ? diffSteps(prevQuote.steps, quote.steps) : null
  const hasStepDiff =
    stepDiff !== null &&
    (stepDiff.added.length > 0 || stepDiff.removed.length > 0 || stepDiff.changed.length > 0)

  return (
    <section className="panel explain-panel" aria-label="价格解释">
      <h2>价格解释 · {quote.planName}</h2>

      {/* 调整前 / 调整后对照 */}
      <div className="compare-box">
        <h3>调整前 / 调整后</h3>
        {!prevQuote || changes.length === 0 ? (
          <p className="muted">尚无调整记录。修改左侧任意条件后，这里会显示对照。</p>
        ) : (
          <>
            <ul className="change-list">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            {prevQuote.status === 'ok' && quote.status === 'ok' ? (
              <p className="compare-total">
                {fmtMoney(prevQuote.total)} → <strong>{fmtMoney(quote.total)}</strong>
                <span className={`delta ${quote.total > prevQuote.total ? 'up' : quote.total < prevQuote.total ? 'down' : ''}`}>
                  {quote.total === prevQuote.total ? '（持平）' : `（${fmtDelta(quote.total - prevQuote.total)}）`}
                </span>
              </p>
            ) : (
              <p className="compare-total">
                状态变化：{STATUS_LABEL[prevQuote.status]} → {STATUS_LABEL[quote.status]}
              </p>
            )}
            {hasStepDiff && (
              <div className="rule-diff">
                {stepDiff.changed.map(({ prev, curr }) => (
                  <p key={curr.ruleId} className="diff-line changed">
                    规则变化「{curr.ruleName}」：{prev.detail} → {curr.detail}
                  </p>
                ))}
                {stepDiff.added.map((s) => (
                  <p key={s.ruleId} className="diff-line added">
                    新命中「{s.ruleName}」：{s.detail}
                  </p>
                ))}
                {stepDiff.removed.map((s) => (
                  <p key={s.ruleId} className="diff-line removed">
                    不再命中「{s.ruleName}」（原：{s.detail}）
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 状态与提示 */}
      {quote.status !== 'ok' && (
        <div className={`status-box ${quote.status}`}>
          {quote.messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {quote.status === 'ok' && quote.messages.length > 0 && (
        <div className="status-box warning">
          {quote.messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {/* 规则叠加列表 */}
      {quote.steps.length > 0 && (
        <>
          <div className="steps-header">
            <h3>规则叠加（按生效顺序）</h3>
            <button type="button" className="link-btn" onClick={toggleAll}>
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          </div>
          <ol className="steps">
            {quote.steps.map((s) => (
              <StepRow key={s.ruleId} step={s} expanded={expanded.has(s.ruleId)} onToggle={() => toggle(s.ruleId)} />
            ))}
          </ol>
          <p className="total-line">
            合计年保费：<strong>{fmtMoney(quote.total)}</strong>
          </p>
        </>
      )}

      {/* 未生效规则 */}
      {quote.excluded.length > 0 && (
        <div className="excluded-box">
          <h3>未生效规则</h3>
          <ul>
            {quote.excluded.map((e) => (
              <li key={e.ruleId}>
                <strong>{e.ruleName}</strong>
                <span>{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
