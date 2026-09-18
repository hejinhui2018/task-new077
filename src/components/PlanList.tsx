import { fmtDelta, fmtMoney } from '../engine/format'
import type { PlanQuote } from '../engine/types'

interface Props {
  quotes: PlanQuote[]
  prevQuotes: PlanQuote[] | null
  selectedPlanId: string
  onSelect: (planId: string) => void
}

export default function PlanList({ quotes, prevQuotes, selectedPlanId, onSelect }: Props) {
  return (
    <section className="panel plan-list" aria-label="方案与保费">
      <h2>方案与保费</h2>
      <div className="plans">
        {quotes.map((q) => {
          const prev = prevQuotes?.find((p) => p.planId === q.planId) ?? null
          const delta = prev && prev.status === 'ok' && q.status === 'ok' ? q.total - prev.total : null
          return (
            <button
              key={q.planId}
              type="button"
              className={`plan-card${q.planId === selectedPlanId ? ' selected' : ''}`}
              onClick={() => onSelect(q.planId)}
            >
              <span className="plan-name">{q.planName}</span>
              <span className="plan-tagline">{q.tagline}</span>
              {q.status === 'ok' ? (
                <span className="plan-price">
                  {fmtMoney(q.total)}
                  <small> / 年</small>
                </span>
              ) : (
                <span className={`plan-status ${q.status}`}>
                  {q.status === 'incomplete' ? `待补充：${q.missing.join('、')}` : '当前条件无法投保'}
                </span>
              )}
              {delta !== null && delta !== 0 && (
                <span className={`plan-delta ${delta > 0 ? 'up' : 'down'}`}>
                  较调整前 {fmtDelta(delta)}
                </span>
              )}
              {delta === 0 && <span className="plan-delta flat">与调整前持平</span>}
            </button>
          )
        })}
      </div>
      <p className="panel-note">点击方案卡片，右侧查看该方案的价格构成。</p>
    </section>
  )
}
