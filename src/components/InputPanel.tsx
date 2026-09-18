import { MAX_AGE, MIN_AGE, REGIONS, RIDERS, SUM_INSURED_OPTIONS, type Rider } from '../engine/data'
import { fmtWan } from '../engine/format'
import type { QuoteInput } from '../engine/types'

interface Props {
  input: QuoteInput
  onChange: (next: QuoteInput) => void
}

function riderFeeLabel(r: Rider): string {
  return r.feeType === 'per10W' ? `${r.fee} 元 / 10 万保额` : `${r.fee} 元 / 年`
}

function riderScopeLabel(r: Rider): string | null {
  const parts: string[] = []
  if (r.minAge !== undefined || r.maxAge !== undefined) parts.push(`${r.minAge}–${r.maxAge} 岁可投`)
  if (r.minSumInsured !== undefined) parts.push(`保额 ≥ ${fmtWan(r.minSumInsured)}`)
  return parts.length ? parts.join(' · ') : null
}

export default function InputPanel({ input, onChange }: Props) {
  const setAge = (raw: string) => {
    if (raw.trim() === '') {
      onChange({ ...input, age: null })
      return
    }
    const n = Number.parseInt(raw, 10)
    onChange({ ...input, age: Number.isNaN(n) ? null : n })
  }

  const toggleRider = (id: string) => {
    const has = input.riderIds.includes(id)
    onChange({
      ...input,
      riderIds: has ? input.riderIds.filter((r) => r !== id) : [...input.riderIds, id],
    })
  }

  const conflictPairs = RIDERS.filter((r) => r.conflictsWith.length > 0)

  return (
    <section className="panel input-panel" aria-label="投保条件">
      <h2>投保条件</h2>

      <label className="field">
        <span className="field-label">年龄（{MIN_AGE}–{MAX_AGE} 周岁）</span>
        <input
          type="number"
          min={MIN_AGE}
          max={MAX_AGE}
          placeholder="请输入年龄"
          value={input.age ?? ''}
          onChange={(e) => setAge(e.target.value)}
        />
        {input.age === null && <span className="field-hint warn">未填写，无法计算</span>}
      </label>

      <label className="field">
        <span className="field-label">投保地区</span>
        <select
          value={input.regionId ?? ''}
          onChange={(e) => onChange({ ...input, regionId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">请选择地区</option>
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}（系数 ×{r.factor}）
            </option>
          ))}
        </select>
        {input.regionId === null && <span className="field-hint warn">未选择，无法计算</span>}
      </label>

      <label className="field">
        <span className="field-label">保障额度</span>
        <select
          value={input.sumInsured ?? ''}
          onChange={(e) =>
            onChange({ ...input, sumInsured: e.target.value === '' ? null : Number(e.target.value) })
          }
        >
          <option value="">请选择额度</option>
          {SUM_INSURED_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {fmtWan(v)}
            </option>
          ))}
        </select>
        {input.sumInsured === null && <span className="field-hint warn">未选择，无法计算</span>}
      </label>

      <fieldset className="field riders">
        <legend>附加险（可多选）</legend>
        {RIDERS.map((r) => {
          const conflictNames = r.conflictsWith
            .map((id) => RIDERS.find((x) => x.id === id)?.name)
            .filter(Boolean)
            .join('、')
          return (
            <label key={r.id} className="rider-item">
              <input
                type="checkbox"
                checked={input.riderIds.includes(r.id)}
                onChange={() => toggleRider(r.id)}
              />
              <span className="rider-body">
                <span className="rider-name">
                  {r.name}
                  <em>{riderFeeLabel(r)}</em>
                </span>
                <span className="rider-meta">
                  {riderScopeLabel(r) && <span className="tag">{riderScopeLabel(r)}</span>}
                  {conflictNames && <span className="tag conflict">与「{conflictNames}」互斥</span>}
                </span>
              </span>
            </label>
          )
        })}
        {conflictPairs.length > 0 && (
          <p className="field-hint">
            提示：互斥的附加险同时勾选时，将按规则优先级自动取舍，并在右侧说明。
          </p>
        )}
      </fieldset>
    </section>
  )
}
