import { useState } from 'react'
import { replayTotals, type AlignedStep, type ExcludedMatch, type QuoteComparison } from '../engine/compare'
import { REGIONS, ruleSetName } from '../engine/data'
import { fmtDelta, fmtMoney, fmtWan } from '../engine/format'
import type { PlanQuote, QuoteInput, QuoteStatus } from '../engine/types'
import type { CompareSnapshot } from '../state/compareHistory'

export interface PlanSummary {
  planId: string
  planName: string
  statusBase: QuoteStatus
  statusCompare: QuoteStatus
  totalBase: number
  totalCompare: number
}

interface Props {
  baseSetName: string
  compareSetName: string
  locked: boolean
  lockedInput: QuoteInput | null
  /** 锁定后左侧输入又被修改过 */
  liveDrifted: boolean
  baseQuote: PlanQuote | null
  compareQuote: PlanQuote | null
  comparison: QuoteComparison | null
  summaries: PlanSummary[]
  selectedPlanId: string
  onSelectPlan: (planId: string) => void
  onToggleLock: () => void
  onSwap: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  canSaveSnapshot: boolean
  onSaveSnapshot: () => void
  snapshots: CompareSnapshot[]
  onLoadSnapshot: (id: string) => void
  onDeleteSnapshot: (id: string) => void
  replay: { key: string } | null
  onReplayTo: (key: string) => void
  onReplayMove: (delta: 1 | -1) => void
  onReplayClose: () => void
}

const STATUS_LABEL: Record<QuoteStatus, string> = {
  ok: '可投保',
  incomplete: '信息不完整',
  unavailable: '无法投保',
}

const MATCH_META = {
  unchanged: { label: '一致', className: 'unchanged' },
  modified: { label: '已修改', className: 'modified' },
  propagated: { label: '影响传播', className: 'propagated' },
  added: { label: '新增', className: 'added' },
  removed: { label: '移除', className: 'removed' },
} as const

const ASPECT_LABEL = {
  priority: '优先级',
  scope: '适用范围',
  detail: '计算说明',
  name: '规则名称',
} as const

function inputSummary(input: QuoteInput): string {
  const region = REGIONS.find((r) => r.id === input.regionId)?.name ?? '未选地区'
  const sum = input.sumInsured !== null ? fmtWan(input.sumInsured) : '未选额度'
  return `${input.age ?? '？'} 岁 · ${region} · ${sum} · 附加险 ${input.riderIds.length} 项`
}

function excludedText(e: ExcludedMatch): string {
  switch (e.type) {
    case 'both':
      return e.reasonChanged
        ? `「${e.b.ruleName}」两侧均未生效，原因不同：基线「${e.a.reason}」→ 对照「${e.b.reason}」`
        : `「${e.b.ruleName}」两侧均未生效（${e.b.reason}）`
    case 'onlyBase':
      return `「${e.a.ruleName}」仅基线中未生效（${e.a.reason}）；对照方案中${e.otherSide === 'hit' ? '已生效' : '未触发或无此规则'}`
    case 'onlyCompare':
      return `「${e.b.ruleName}」仅对照方案中未生效（${e.b.reason}）；基线中${e.otherSide === 'hit' ? '已生效' : '未触发或无此规则'}`
  }
}

function DiffRow({
  step,
  replaying,
  causedByName,
  onReplay,
}: {
  step: AlignedStep
  replaying: boolean
  causedByName: string | null
  onReplay: () => void
}) {
  const m = step.match
  const meta = MATCH_META[m.type]
  const name = m.type === 'removed' ? m.a.ruleName : m.b.ruleName
  const hasPriorityChange = m.type === 'modified' && m.aspects.some((a) => a.field === 'priority')

  const amounts = (() => {
    switch (m.type) {
      case 'added':
        return `本规则贡献 +${fmtMoney(m.b.amountAfter - m.b.amountBefore)}`
      case 'removed':
        return `原贡献 +${fmtMoney(m.a.amountAfter - m.a.amountBefore)}，不再生效`
      default:
        return `${fmtMoney(m.a.amountAfter)} → ${fmtMoney(m.b.amountAfter)}`
    }
  })()

  return (
    <li className={`diff-row ${meta.className}${replaying ? ' replaying' : ''}`}>
      <button type="button" className="diff-main" onClick={onReplay} title="从此节点重放">
        <span className={`diff-badge ${meta.className}`}>{meta.label}</span>
        {hasPriorityChange && <span className="diff-badge priority">优先级变化</span>}
        <span className="diff-name">{name}</span>
        <span className="diff-amounts">{amounts}</span>
        <span className="diff-replay-hint">重放 ▸</span>
      </button>
      {m.type === 'modified' && (
        <ul className="aspect-list">
          {m.aspects.map((a) => (
            <li key={a.field}>
              <em>{ASPECT_LABEL[a.field]}</em>
              <span>
                {a.before} → {a.after}
              </span>
            </li>
          ))}
        </ul>
      )}
      {m.type === 'propagated' && (
        <p className="prop-note">
          规则本身未变，受「{causedByName ?? '上游规则变化'}」影响，金额 {fmtMoney(m.a.amountAfter)} →{' '}
          {fmtMoney(m.b.amountAfter)}
        </p>
      )}
    </li>
  )
}

export default function ComparePanel(props: Props) {
  const {
    baseSetName,
    compareSetName,
    locked,
    lockedInput,
    liveDrifted,
    baseQuote,
    compareQuote,
    comparison,
    summaries,
    selectedPlanId,
    onSelectPlan,
    onToggleLock,
    onSwap,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    canSaveSnapshot,
    onSaveSnapshot,
    snapshots,
    onLoadSnapshot,
    onDeleteSnapshot,
    replay,
    onReplayTo,
    onReplayMove,
    onReplayClose,
  } = props

  const [hideUnchanged, setHideUnchanged] = useState(false)

  const bothOk = comparison !== null && comparison.statusBase === 'ok' && comparison.statusCompare === 'ok'

  // 重放游标：从当前对照结果中按对齐键定位（规则链变化后自动跟随）
  const replayIndex =
    replay && comparison ? comparison.steps.findIndex((s) => s.key === replay.key) : -1
  const replayActive = replayIndex >= 0 && comparison !== null
  const replaySum = replayActive && comparison ? replayTotals(comparison.steps, replayIndex) : null

  const nameByKey = new Map<string, string>()
  if (comparison) {
    for (const s of comparison.steps) {
      const m = s.match
      nameByKey.set(s.key, m.type === 'removed' ? m.a.ruleName : m.b.ruleName)
    }
  }

  const visibleSteps = comparison
    ? comparison.steps.filter((s) => !hideUnchanged || s.match.type !== 'unchanged')
    : []

  return (
    <section className="panel compare-panel" aria-label="规则方案对照">
      <div className="compare-header">
        <div>
          <h2>规则方案对照</h2>
          <p className="panel-note">
            同一输入快照分别运行两套规则，逐步按规则 ID 对齐（名称相似不视为同一规则）
          </p>
        </div>
        <div className="compare-controls">
          <span className="baseline-tag">
            基线 <strong>{baseSetName}</strong> → 对照 <strong>{compareSetName}</strong>
          </span>
          <button type="button" onClick={onSwap} title="交换基线与对照的方向">
            ⇄ 交换基线
          </button>
          <button
            type="button"
            className={locked ? 'lock-btn locked' : 'lock-btn'}
            onClick={onToggleLock}
            title={locked ? '解锁后跟随左侧实时输入' : '锁定当前输入作为对照快照'}
          >
            {locked ? '🔒 已锁定输入' : '🔓 锁定输入'}
          </button>
          <button type="button" onClick={onUndo} disabled={!canUndo}>
            ↩ 撤销
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            ↪ 重做
          </button>
          <button type="button" onClick={onSaveSnapshot} disabled={!canSaveSnapshot}>
            💾 保存比较快照
          </button>
        </div>
      </div>

      <p className={`lock-summary${locked ? ' locked' : ''}`}>
        {locked && lockedInput ? (
          <>
            对照基于锁定快照：<strong>{inputSummary(lockedInput)}</strong>
            {liveDrifted ? '（左侧输入已修改，不影响本对照；解锁后跟随实时输入）' : '（解锁后跟随左侧实时输入）'}
          </>
        ) : (
          '未锁定：对照跟随左侧输入实时变化。点击「锁定输入」可固定一份输入快照再调整规则对照。'
        )}
      </p>

      {/* 各方案总价对照 */}
      <div className="plan-summary-strip">
        {summaries.map((s) => {
          const bothPlanOk = s.statusBase === 'ok' && s.statusCompare === 'ok'
          const delta = bothPlanOk ? s.totalCompare - s.totalBase : null
          return (
            <button
              key={s.planId}
              type="button"
              className={`plan-summary-card${s.planId === selectedPlanId ? ' selected' : ''}`}
              onClick={() => onSelectPlan(s.planId)}
            >
              <span className="plan-summary-name">{s.planName}</span>
              {bothPlanOk && delta !== null ? (
                <span className="plan-summary-totals">
                  {fmtMoney(s.totalBase)} → {fmtMoney(s.totalCompare)}
                  <em className={delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}>
                    {delta === 0 ? '持平' : fmtDelta(delta)}
                  </em>
                </span>
              ) : (
                <span className="plan-summary-totals">
                  {STATUS_LABEL[s.statusBase]} → {STATUS_LABEL[s.statusCompare]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {!comparison || !baseQuote || !compareQuote ? (
        <p className="muted">所选方案在其中一套规则中不存在，无法对照。</p>
      ) : !bothOk ? (
        <div className="status-box warning">
          <p>
            基线（{baseSetName}）：{STATUS_LABEL[baseQuote.status]}
            {baseQuote.missing.length > 0 && `（缺少：${baseQuote.missing.join('、')}）`}
          </p>
          {baseQuote.messages.map((m) => (
            <p key={`base-${m}`} className="muted">
              {m}
            </p>
          ))}
          <p>
            对照（{compareSetName}）：{STATUS_LABEL[compareQuote.status]}
            {compareQuote.missing.length > 0 && `（缺少：${compareQuote.missing.join('、')}）`}
          </p>
          {compareQuote.messages.map((m) => (
            <p key={`compare-${m}`} className="muted">
              {m}
            </p>
          ))}
        </div>
      ) : (
        <>
          {/* 统计与图例 */}
          <div className="compare-stats">
            <span className="stat added">新增 {comparison.stats.added}</span>
            <span className="stat removed">移除 {comparison.stats.removed}</span>
            <span className="stat modified">已修改 {comparison.stats.modified}</span>
            <span className="stat propagated">影响传播 {comparison.stats.propagated}</span>
            <span className="stat unchanged">一致 {comparison.stats.unchanged}</span>
            <label className="hide-toggle">
              <input
                type="checkbox"
                checked={hideUnchanged}
                onChange={(e) => setHideUnchanged(e.target.checked)}
              />
              隐藏一致项
            </label>
          </div>

          <p className="compare-total">
            合计年保费：{fmtMoney(comparison.totalBase ?? 0)} →{' '}
            <strong>{fmtMoney(comparison.totalCompare ?? 0)}</strong>
            <span
              className={`delta ${
                (comparison.totalDelta ?? 0) > 0 ? 'up' : (comparison.totalDelta ?? 0) < 0 ? 'down' : ''
              }`}
            >
              {comparison.totalDelta === 0 ? '（持平）' : `（${fmtDelta(comparison.totalDelta ?? 0)}）`}
            </span>
          </p>

          {comparison.firstDivergence === null && (
            <p className="muted">两套规则在当前输入下的计算链完全一致。</p>
          )}

          {/* 重放条 */}
          {replayActive && replaySum && (
            <div className="replay-bar">
              <span className="replay-title">从差异节点重放</span>
              <button type="button" onClick={() => onReplayMove(-1)} disabled={replayIndex <= 0}>
                ◀ 上一步
              </button>
              <span className="replay-pos">
                第 {replayIndex + 1} / {comparison.steps.length} 步 · {nameByKey.get(replay!.key) ?? replay!.key}
              </span>
              <button
                type="button"
                onClick={() => onReplayMove(1)}
                disabled={replayIndex >= comparison.steps.length - 1}
              >
                下一步 ▶
              </button>
              <span className="replay-totals">
                基线 {fmtMoney(replaySum.base)} ｜ 对照 {fmtMoney(replaySum.compare)}
                <em className={replaySum.compare > replaySum.base ? 'up' : replaySum.compare < replaySum.base ? 'down' : 'flat'}>
                  {fmtDelta(Math.round((replaySum.compare - replaySum.base) * 100) / 100)}
                </em>
              </span>
              <button type="button" className="link-btn" onClick={onReplayClose}>
                结束重放
              </button>
            </div>
          )}

          {/* 逐步差异列表 */}
          <ol className="diff-list">
            {visibleSteps.map((step) => {
              const m = step.match
              const causedByName = m.type === 'propagated' && m.causedBy ? (nameByKey.get(m.causedBy) ?? null) : null
              return (
                <DiffRow
                  key={step.key}
                  step={step}
                  replaying={replayActive && comparison.steps[replayIndex].key === step.key}
                  causedByName={causedByName}
                  onReplay={() => onReplayTo(step.key)}
                />
              )
            })}
          </ol>

          {/* 未生效规则对照 */}
          {comparison.excluded.length > 0 && (
            <div className="excluded-diff">
              <h3>未生效规则对照</h3>
              <ul>
                {comparison.excluded.map((e) => (
                  <li key={e.type === 'onlyCompare' ? e.b.ruleId : e.a.ruleId}>{excludedText(e)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 提示信息差异 */}
          {(comparison.messagesAdded.length > 0 || comparison.messagesRemoved.length > 0) && (
            <div className="msg-diff">
              {comparison.messagesRemoved.map((m) => (
                <p key={m} className="diff-line removed">
                  仅基线提示：{m}
                </p>
              ))}
              {comparison.messagesAdded.map((m) => (
                <p key={m} className="diff-line added">
                  仅对照提示：{m}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {/* 比较快照 */}
      <div className="snapshot-bar">
        <h3>比较快照</h3>
        {snapshots.length === 0 ? (
          <p className="muted">尚未保存快照。调整好输入与对照方向后，点击「保存比较快照」。</p>
        ) : (
          <ul className="snapshot-list">
            {snapshots.map((s) => (
              <li key={s.id} className="snapshot-item">
                <div className="snapshot-info">
                  <strong>{s.label}</strong>
                  <span className="muted">
                    {new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false })} ·{' '}
                    {ruleSetName(s.baseSetId)} → {ruleSetName(s.compareSetId)}
                    {s.result.totalDelta !== null &&
                      ` · 差价 ${fmtDelta(s.result.totalDelta)}（新增 ${s.result.stats.added} / 移除 ${s.result.stats.removed} / 修改 ${s.result.stats.modified}）`}
                  </span>
                </div>
                <div className="snapshot-actions">
                  <button type="button" onClick={() => onLoadSnapshot(s.id)}>
                    载入
                  </button>
                  <button type="button" onClick={() => onDeleteSnapshot(s.id)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
