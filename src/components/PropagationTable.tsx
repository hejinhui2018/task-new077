import { useState } from 'react'
import { replayTotals, type PropagationRow, type RowStatus } from '../engine/compare'
import { fmtDelta, fmtMoney } from '../engine/format'
import type { PlanQuote } from '../engine/types'

interface Props {
  planName: string
  nameA: string
  nameB: string
  quoteA: PlanQuote
  quoteB: PlanQuote
  rows: PropagationRow[]
}

const STATUS_LABEL: Record<RowStatus, string> = {
  unchanged: '一致',
  'priority-changed': '优先级变化',
  modified: '参数变化',
  added: '新增',
  removed: '移除',
}

const KIND_LABEL = { base: '基础', age: '年龄', region: '地区', discount: '优惠', rider: '附加险' } as const

function AmountCell({ before, after }: { before: number; after: number }) {
  return (
    <>
      {fmtMoney(before)} → <strong>{fmtMoney(after)}</strong>
    </>
  )
}

/** 影响传播：同一输入快照下，两套规则集逐步对照，以及从任意差异节点开始的重放。 */
export default function PropagationTable({ planName, nameA, nameB, quoteA, quoteB, rows }: Props) {
  const [replay, setReplay] = useState<{ start: number; cursor: number } | null>(null)

  if (quoteA.status !== 'ok' || quoteB.status !== 'ok') {
    return (
      <section className="panel propagation-panel">
        <h2>影响传播 · {planName}</h2>
        <p className="muted">
          当前输入下无法对照：{nameA} 为「{quoteA.status === 'ok' ? '可投保' : quoteA.status === 'incomplete' ? '信息不完整' : '无法投保'}」，{nameB} 为「
          {quoteB.status === 'ok' ? '可投保' : quoteB.status === 'incomplete' ? '信息不完整' : '无法投保'}」。请先在试算页补全投保条件。
        </p>
      </section>
    )
  }

  // 每一行渲染时的累计金额（与 replayTotals 同一份逻辑，逐行推进）
  const running: Array<{ a: number; b: number }> = []
  for (let i = 0; i <= rows.length; i += 1) running.push(replayTotals(rows, i))

  const startReplay = (index: number) => setReplay({ start: index, cursor: index })
  const stopReplay = () => setReplay(null)

  const cursorTotals = replay ? running[replay.cursor + 1] : null

  return (
    <section className="panel propagation-panel">
      <div className="steps-header">
        <h2>影响传播 · {planName}</h2>
        {replay && (
          <button type="button" className="link-btn" onClick={stopReplay}>
            退出重放
          </button>
        )}
      </div>
      <p className="panel-note">
        同一输入快照分别在「{nameA}」与「{nameB}」下计算，步骤按规则匹配结果对齐；点击任意一行可从该差异节点开始逐步重放。
      </p>

      <table className="prop-table">
        <thead>
          <tr>
            <th>步骤</th>
            <th>规则</th>
            <th>规则状态</th>
            <th>{nameA}</th>
            <th>{nameB}</th>
            <th>累计差（B−A）</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {replay && replay.start > 0 && (
            <tr className="replay-summary">
              <td colSpan={7}>
                前置 {replay.start} 步已折叠：{nameA} 累计 {fmtMoney(running[replay.start].a)} · {nameB} 累计{' '}
                {fmtMoney(running[replay.start].b)}
              </td>
            </tr>
          )}
          {rows.map((row, i) => {
            if (replay && i < replay.start) return null
            const step = row.a ?? row.b
            if (!step) return null
            const totals = running[i + 1]
            const delta = Math.round((totals.b - totals.a) * 100) / 100
            const diverged = row.a !== null && row.b !== null && row.a.amountAfter !== row.b.amountAfter
            const cls = [
              'prop-row',
              diverged ? 'diverged' : '',
              replay && i === replay.cursor ? 'active' : '',
              replay && i > replay.cursor ? 'pending' : '',
              replay && i < replay.cursor ? 'replayed' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <tr key={row.key} className={cls}>
                <td className="step-no">
                  {row.aIndex !== null ? row.aIndex + 1 : '—'}
                  {row.bIndex !== null && row.bIndex !== row.aIndex ? ` → ${row.bIndex + 1}` : ''}
                </td>
                <td>
                  <span className={`kind-badge ${step.kind}`}>{KIND_LABEL[step.kind]}</span>{' '}
                  {row.a?.ruleName ?? row.b?.ruleName}
                  {row.a && row.b && row.a.ruleName !== row.b.ruleName && ` → ${row.b.ruleName}`}
                </td>
                <td>
                  <span className={`status-badge ${row.status}`}>{STATUS_LABEL[row.status]}</span>
                </td>
                <td>
                  {row.a ? (
                    <AmountCell before={row.a.amountBefore} after={row.a.amountAfter} />
                  ) : (
                    <span className="muted">{row.status === 'added' ? '无此规则' : '未命中'}</span>
                  )}
                </td>
                <td>
                  {row.b ? (
                    <AmountCell before={row.b.amountBefore} after={row.b.amountAfter} />
                  ) : (
                    <span className="muted">{row.status === 'removed' ? '无此规则' : '未命中'}</span>
                  )}
                </td>
                <td className={delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'}>{fmtDelta(delta)}</td>
                <td>
                  {!replay && (
                    <button type="button" className="link-btn" onClick={() => startReplay(i)}>
                      从此重放
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>合计年保费</td>
            <td>
              <strong>{fmtMoney(quoteA.total)}</strong>
            </td>
            <td>
              <strong>{fmtMoney(quoteB.total)}</strong>
            </td>
            <td className={`delta ${quoteB.total > quoteA.total ? 'up' : quoteB.total < quoteA.total ? 'down' : ''}`}>
              {fmtDelta(Math.round((quoteB.total - quoteA.total) * 100) / 100)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {replay && cursorTotals && (
        <div className="replay-controls">
          <span>
            重放中：第 {replay.cursor + 1} / {rows.length} 步 · {nameA} {fmtMoney(cursorTotals.a)} · {nameB}{' '}
            {fmtMoney(cursorTotals.b)} · 差 {fmtDelta(Math.round((cursorTotals.b - cursorTotals.a) * 100) / 100)}
          </span>
          <span className="replay-buttons">
            <button
              type="button"
              onClick={() => setReplay({ ...replay, cursor: Math.max(replay.start, replay.cursor - 1) })}
              disabled={replay.cursor <= replay.start}
            >
              ◀ 上一步
            </button>
            <button
              type="button"
              onClick={() => setReplay({ ...replay, cursor: Math.min(rows.length - 1, replay.cursor + 1) })}
              disabled={replay.cursor >= rows.length - 1}
            >
              下一步 ▶
            </button>
            <button type="button" onClick={() => setReplay({ ...replay, cursor: rows.length - 1 })}>到末尾</button>
          </span>
        </div>
      )}
    </section>
  )
}
