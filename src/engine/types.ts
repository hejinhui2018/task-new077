/** 投保条件输入。null 表示尚未填写（触发“输入不完整”状态）。 */
export interface QuoteInput {
  age: number | null
  regionId: string | null
  /** 保障额度（元） */
  sumInsured: number | null
  /** 已勾选的附加险 id */
  riderIds: string[]
}

export type RuleKind = 'base' | 'age' | 'region' | 'discount' | 'rider'

/** 一条命中规则的计算痕迹，用于右侧“价格由哪些规则叠加而来”的解释。 */
export interface CalcStep {
  ruleId: string
  ruleName: string
  kind: RuleKind
  /** 规则优先级，数值越大越优先（互斥取舍与折扣叠加顺序都按它） */
  priority: number
  /** 适用范围的文字说明 */
  scopeText: string
  /** 本次命中的具体计算说明 */
  detail: string
  amountBefore: number
  amountAfter: number
}

/** 命中了适用条件、但最终未生效的规则（被互斥掉 / 不在适用范围）。 */
export interface ExcludedRule {
  ruleId: string
  ruleName: string
  reason: string
}

export type QuoteStatus = 'ok' | 'incomplete' | 'unavailable'

export interface PlanQuote {
  planId: string
  planName: string
  tagline: string
  status: QuoteStatus
  /** 缺失的输入项名称（status = incomplete 时非空） */
  missing: string[]
  /** 需要向顾问明示的提示：互斥取舍、附加险未生效等 */
  messages: string[]
  total: number
  steps: CalcStep[]
  excluded: ExcludedRule[]
}
