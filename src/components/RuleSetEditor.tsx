import { useState } from 'react'
import type { Discount } from '../engine/data'
import { nextRuleId, type RuleSet } from '../engine/ruleset'

interface Props {
  ruleset: RuleSet
  onChange: (next: RuleSet) => void
}

/* ---------- 失焦才提交的输入框：避免每次击键都产生一条撤销历史 ---------- */

function TextField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="text"
      value={draft ?? value}
      placeholder={placeholder}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = (draft ?? value).trim()
        setDraft(null)
        if (next && next !== value) onCommit(next)
      }}
    />
  )
}

function NumberField({
  value,
  onCommit,
  step = 1,
  placeholder,
}: {
  value: number | undefined
  onCommit: (v: number | undefined) => void
  step?: number
  placeholder?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === undefined ? '' : String(value))
  return (
    <input
      type="number"
      step={step}
      value={shown}
      placeholder={placeholder}
      onFocus={() => setDraft(shown)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const raw = (draft ?? shown).trim()
        setDraft(null)
        if (raw === '') {
          if (value !== undefined) onCommit(undefined)
          return
        }
        const n = Number(raw)
        if (Number.isNaN(n) || n === value) return
        onCommit(n)
      }}
    />
  )
}

const updateAt = <T,>(arr: T[], i: number, next: T): T[] => arr.map((x, j) => (j === i ? next : x))
const removeAt = <T,>(arr: T[], i: number): T[] => arr.filter((_, j) => j !== i)

/** 单侧规则集编辑器：所有修改通过 onChange 产出新规则集（不可变更新）。 */
export default function RuleSetEditor({ ruleset, onChange }: Props) {
  const rs = ruleset

  return (
    <div className="ruleset-editor">
      <div className="editor-row editor-head">
        <label>
          <span>规则集名称</span>
          <TextField value={rs.name} onCommit={(name) => onChange({ ...rs, name })} />
        </label>
        <label>
          <span>投保年龄</span>
          <span className="inline-fields">
            <NumberField value={rs.minAge} onCommit={(v) => v !== undefined && onChange({ ...rs, minAge: v })} />
            –
            <NumberField value={rs.maxAge} onCommit={(v) => v !== undefined && onChange({ ...rs, maxAge: v })} />
          </span>
        </label>
      </div>

      <section className="editor-section">
        <h3>基础费率（每 10 万保额年保费）</h3>
        {rs.plans.map((p, i) => (
          <div className="editor-row" key={p.id}>
            <span className="row-label" title={p.tagline}>
              {p.name}
            </span>
            <NumberField
              value={p.baseRatePer10W}
              onCommit={(v) => v !== undefined && onChange({ ...rs, plans: updateAt(rs.plans, i, { ...p, baseRatePer10W: v }) })}
            />
            <span className="unit">元</span>
          </div>
        ))}
      </section>

      <section className="editor-section">
        <h3>年龄费率（区间含端点）</h3>
        {rs.ageBands.map((b, i) => (
          <div className="editor-row" key={b.id}>
            <TextField value={b.label} onCommit={(label) => onChange({ ...rs, ageBands: updateAt(rs.ageBands, i, { ...b, label }) })} />
            <span className="inline-fields">
              <NumberField value={b.min} onCommit={(v) => v !== undefined && onChange({ ...rs, ageBands: updateAt(rs.ageBands, i, { ...b, min: v }) })} />
              –
              <NumberField value={b.max} onCommit={(v) => v !== undefined && onChange({ ...rs, ageBands: updateAt(rs.ageBands, i, { ...b, max: v }) })} />
              岁
            </span>
            <span className="inline-fields">
              ×
              <NumberField
                step={0.1}
                value={b.factor}
                onCommit={(v) => v !== undefined && onChange({ ...rs, ageBands: updateAt(rs.ageBands, i, { ...b, factor: v }) })}
              />
            </span>
            <button type="button" className="link-btn danger" onClick={() => onChange({ ...rs, ageBands: removeAt(rs.ageBands, i) })}>
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            onChange({
              ...rs,
              ageBands: [...rs.ageBands, { id: nextRuleId('age', rs.ageBands), label: '新年龄段', min: rs.minAge, max: rs.maxAge, factor: 1 }],
            })
          }
        >
          ＋ 添加年龄段
        </button>
      </section>

      <section className="editor-section">
        <h3>地区系数</h3>
        {rs.regions.map((r, i) => (
          <div className="editor-row" key={r.id}>
            <span className="row-label">{r.name}</span>
            <span className="inline-fields">
              ×
              <NumberField
                step={0.05}
                value={r.factor}
                onCommit={(v) => v !== undefined && onChange({ ...rs, regions: updateAt(rs.regions, i, { ...r, factor: v }) })}
              />
            </span>
          </div>
        ))}
      </section>

      <section className="editor-section">
        <h3>折扣规则（按优先级从高到低叠加）</h3>
        {rs.discounts.map((d, i) => {
          const c = d.condition
          const setCondition = (condition: Discount['condition']) =>
            onChange({ ...rs, discounts: updateAt(rs.discounts, i, { ...d, condition }) })
          return (
            <div className="editor-card" key={d.id}>
              <div className="editor-row">
                <TextField value={d.name} onCommit={(name) => onChange({ ...rs, discounts: updateAt(rs.discounts, i, { ...d, name }) })} />
                <select
                  value={c.type}
                  onChange={(e) =>
                    setCondition(
                      e.target.value === 'ageBetween'
                        ? { type: 'ageBetween', min: rs.minAge, max: rs.maxAge }
                        : { type: 'sumInsuredAtLeast', value: 500000 },
                    )
                  }
                >
                  <option value="ageBetween">年龄区间</option>
                  <option value="sumInsuredAtLeast">保额门槛</option>
                </select>
                {c.type === 'ageBetween' ? (
                  <span className="inline-fields">
                    <NumberField value={c.min} onCommit={(v) => v !== undefined && setCondition({ ...c, min: v })} />
                    –
                    <NumberField value={c.max} onCommit={(v) => v !== undefined && setCondition({ ...c, max: v })} />
                    岁
                  </span>
                ) : (
                  <span className="inline-fields">
                    保额 ≥
                    <NumberField value={c.value} onCommit={(v) => v !== undefined && setCondition({ ...c, value: v })} />
                    元
                  </span>
                )}
              </div>
              <div className="editor-row">
                <span className="inline-fields">
                  系数 ×
                  <NumberField
                    step={0.01}
                    value={d.factor}
                    onCommit={(v) => v !== undefined && onChange({ ...rs, discounts: updateAt(rs.discounts, i, { ...d, factor: v }) })}
                  />
                </span>
                <span className="inline-fields">
                  优先级
                  <NumberField
                    value={d.priority}
                    onCommit={(v) => v !== undefined && onChange({ ...rs, discounts: updateAt(rs.discounts, i, { ...d, priority: v }) })}
                  />
                </span>
                <button type="button" className="link-btn danger" onClick={() => onChange({ ...rs, discounts: removeAt(rs.discounts, i) })}>
                  删除
                </button>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            onChange({
              ...rs,
              discounts: [
                ...rs.discounts,
                {
                  id: nextRuleId('discount', rs.discounts),
                  name: '新折扣',
                  description: '自定义折扣',
                  priority: 1,
                  factor: 1,
                  condition: { type: 'ageBetween', min: rs.minAge, max: rs.maxAge },
                },
              ],
            })
          }
        >
          ＋ 添加折扣
        </button>
      </section>

      <section className="editor-section">
        <h3>附加险（互斥按优先级取舍）</h3>
        {rs.riders.map((r, i) => (
          <div className="editor-card" key={r.id}>
            <div className="editor-row">
              <TextField value={r.name} onCommit={(name) => onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, name }) })} />
              <select
                value={r.feeType}
                onChange={(e) => onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, feeType: e.target.value as 'per10W' | 'flat' }) })}
              >
                <option value="per10W">按每 10 万保额</option>
                <option value="flat">定额年费</option>
              </select>
              <span className="inline-fields">
                费率
                <NumberField
                  value={r.fee}
                  onCommit={(v) => v !== undefined && onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, fee: v }) })}
                />
                元
              </span>
              <span className="inline-fields">
                优先级
                <NumberField
                  value={r.priority}
                  onCommit={(v) => v !== undefined && onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, priority: v }) })}
                />
              </span>
              <button type="button" className="link-btn danger" onClick={() => onChange({ ...rs, riders: removeAt(rs.riders, i) })}>
                删除
              </button>
            </div>
            <div className="editor-row">
              <span className="inline-fields">
                年龄
                <NumberField
                  placeholder="不限"
                  value={r.minAge}
                  onCommit={(v) => onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, minAge: v }) })}
                />
                –
                <NumberField
                  placeholder="不限"
                  value={r.maxAge}
                  onCommit={(v) => onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, maxAge: v }) })}
                />
                岁
              </span>
              <span className="inline-fields">
                保额 ≥
                <NumberField
                  placeholder="不限"
                  value={r.minSumInsured}
                  onCommit={(v) => onChange({ ...rs, riders: updateAt(rs.riders, i, { ...r, minSumInsured: v }) })}
                />
                元
              </span>
            </div>
            {rs.riders.length > 1 && (
              <div className="editor-row conflicts-row">
                <span className="row-label">互斥：</span>
                {rs.riders
                  .filter((x) => x.id !== r.id)
                  .map((x) => (
                    <label key={x.id} className="conflict-check">
                      <input
                        type="checkbox"
                        checked={r.conflictsWith.includes(x.id)}
                        onChange={(e) =>
                          onChange({
                            ...rs,
                            riders: updateAt(rs.riders, i, {
                              ...r,
                              conflictsWith: e.target.checked
                                ? [...r.conflictsWith, x.id]
                                : r.conflictsWith.filter((id) => id !== x.id),
                            }),
                          })
                        }
                      />
                      {x.name}
                    </label>
                  ))}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            onChange({
              ...rs,
              riders: [
                ...rs.riders,
                {
                  id: nextRuleId('rider', rs.riders),
                  name: '新附加险',
                  description: '自定义附加险',
                  feeType: 'flat',
                  fee: 100,
                  priority: 1,
                  conflictsWith: [],
                },
              ],
            })
          }
        >
          ＋ 添加附加险
        </button>
      </section>
    </div>
  )
}
