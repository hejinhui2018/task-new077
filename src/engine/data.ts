import type { QuoteInput } from './types'

/* ================= 方案（基础保障） ================= */

export interface Plan {
  id: string
  name: string
  tagline: string
  /** 每 10 万保额的年基础保费（元） */
  baseRatePer10W: number
}

export const PLANS: Plan[] = [
  { id: 'basic', name: '基础版', tagline: '意外身故 / 伤残基础保障', baseRatePer10W: 90 },
  { id: 'standard', name: '标准版', tagline: '基础保障 + 意外医疗垫付', baseRatePer10W: 120 },
  { id: 'premium', name: '尊享版', tagline: '标准版 + 全球紧急救援', baseRatePer10W: 160 },
]

/* ================= 地区系数 ================= */

export interface Region {
  id: string
  name: string
  factor: number
}

export const REGIONS: Region[] = [
  { id: 'north', name: '华北', factor: 1.0 },
  { id: 'east', name: '华东', factor: 1.1 },
  { id: 'south', name: '华南', factor: 0.95 },
  { id: 'west', name: '西部', factor: 0.9 },
]

/* ================= 年龄费率（区间含端点） ================= */

export interface AgeBand {
  id: string
  label: string
  min: number
  max: number
  factor: number
}

export const MIN_AGE = 0
export const MAX_AGE = 70

export const AGE_BANDS: AgeBand[] = [
  { id: 'minor', label: '未成年费率', min: 0, max: 17, factor: 0.5 },
  { id: 'youth', label: '青年费率', min: 18, max: 30, factor: 1.0 },
  { id: 'prime', label: '壮年费率', min: 31, max: 45, factor: 1.4 },
  { id: 'middle', label: '中年费率', min: 46, max: 60, factor: 2.0 },
  { id: 'senior', label: '老年费率', min: 61, max: 70, factor: 3.2 },
]

/* ================= 附加险（含互斥与适用范围） ================= */

export interface Rider {
  id: string
  name: string
  description: string
  /** per10W：按每 10 万保额收费；flat：定额年费 */
  feeType: 'per10W' | 'flat'
  fee: number
  priority: number
  /** 互斥的附加险 id（引擎按双向处理） */
  conflictsWith: string[]
  minAge?: number
  maxAge?: number
  minSumInsured?: number
}

export const RIDERS: Rider[] = [
  {
    id: 'acc-death',
    name: '意外身故伤残加倍',
    description: '意外身故 / 伤残保额加倍给付',
    feeType: 'per10W',
    fee: 45,
    priority: 10,
    conflictsWith: [],
  },
  {
    id: 'acc-medical-basic',
    name: '意外医疗（社保内）',
    description: '社保目录内意外医疗费用报销',
    feeType: 'per10W',
    fee: 20,
    priority: 5,
    conflictsWith: ['acc-medical-plus'],
  },
  {
    id: 'acc-medical-plus',
    name: '意外医疗（不限社保）',
    description: '不限社保目录，含自费药与进口器材',
    feeType: 'per10W',
    fee: 38,
    priority: 8,
    conflictsWith: ['acc-medical-basic'],
  },
  {
    id: 'hospital-allowance',
    name: '意外住院津贴',
    description: '意外住院每日定额津贴',
    feeType: 'flat',
    fee: 120,
    priority: 4,
    conflictsWith: [],
    minAge: 18,
    maxAge: 60,
  },
  {
    id: 'critical',
    name: '重大疾病附加',
    description: '覆盖 120 种重大疾病，确诊即付',
    feeType: 'per10W',
    fee: 65,
    priority: 6,
    conflictsWith: [],
    minAge: 18,
    maxAge: 55,
  },
  {
    id: 'waiver',
    name: '保费豁免',
    description: '确诊重疾后豁免后续保费',
    feeType: 'flat',
    fee: 60,
    priority: 3,
    conflictsWith: [],
    minSumInsured: 300000,
  },
]

/* ================= 折扣规则（按优先级从高到低依次叠加） ================= */

export type DiscountCondition =
  | { type: 'sumInsuredAtLeast'; value: number }
  | { type: 'ageBetween'; min: number; max: number }

export interface Discount {
  id: string
  name: string
  description: string
  priority: number
  factor: number
  condition: DiscountCondition
}

export const DISCOUNTS: Discount[] = [
  {
    id: 'big-policy',
    name: '大额保单优惠',
    description: '保额达到 50 万，保费 95 折',
    priority: 20,
    factor: 0.95,
    condition: { type: 'sumInsuredAtLeast', value: 500000 },
  },
  {
    id: 'youth',
    name: '青年费率优惠',
    description: '18–30 周岁投保，保费 9 折',
    priority: 10,
    factor: 0.9,
    condition: { type: 'ageBetween', min: 18, max: 30 },
  },
]

/* ================= 规则集：一次完整的规则版本 ================= */

/**
 * 一套独立、自洽的规则版本。对照功能从同一输入快照分别运行两套规则集，
 * 再按规则 ID 逐步对齐差异 —— 规则身份只看 id，绝不按名称猜测。
 */
export interface RuleSet {
  id: string
  name: string
  description: string
  minAge: number
  maxAge: number
  plans: Plan[]
  regions: Region[]
  ageBands: AgeBand[]
  riders: Rider[]
  discounts: Discount[]
}

/* ================= 规则集 A：现行规则 ================= */

export const RULESET_A: RuleSet = {
  id: 'A',
  name: '现行规则 A',
  description: '当前线上运行的规则版本',
  minAge: MIN_AGE,
  maxAge: MAX_AGE,
  plans: PLANS,
  regions: REGIONS,
  ageBands: AGE_BANDS,
  riders: RIDERS,
  discounts: DISCOUNTS,
}

/* ================= 规则集 B：修订方案 =================
 * 与 A 的差异覆盖：费率调整、年龄边界移动、投保年龄上限提高、
 * 折扣门槛 / 优先级变化、新增折扣、附加险新增 / 移除 / 范围与优先级调整。
 */

const B_PLANS: Plan[] = [
  { id: 'basic', name: '基础版', tagline: '意外身故 / 伤残基础保障', baseRatePer10W: 90 },
  { id: 'standard', name: '标准版', tagline: '基础保障 + 意外医疗垫付', baseRatePer10W: 115 },
  { id: 'premium', name: '尊享版', tagline: '标准版 + 全球紧急救援', baseRatePer10W: 168 },
]

const B_REGIONS: Region[] = [
  { id: 'north', name: '华北', factor: 1.0 },
  { id: 'east', name: '华东', factor: 1.08 },
  { id: 'south', name: '华南', factor: 0.95 },
  { id: 'west', name: '西部', factor: 0.9 },
]

const B_AGE_BANDS: AgeBand[] = [
  { id: 'minor', label: '未成年费率', min: 0, max: 17, factor: 0.5 },
  { id: 'youth', label: '青年费率', min: 18, max: 28, factor: 1.0 },
  { id: 'prime', label: '壮年费率', min: 29, max: 45, factor: 1.4 },
  { id: 'middle', label: '中年费率', min: 46, max: 60, factor: 2.0 },
  { id: 'senior', label: '老年费率', min: 61, max: 75, factor: 3.2 },
]

const B_RIDERS: Rider[] = [
  {
    id: 'acc-death',
    name: '意外身故伤残加倍',
    description: '意外身故 / 伤残保额加倍给付',
    feeType: 'per10W',
    fee: 45,
    priority: 10,
    conflictsWith: [],
  },
  // 「意外医疗（社保内）」在修订方案中下线
  {
    id: 'acc-medical-plus',
    name: '意外医疗（不限社保）',
    description: '不限社保目录，含自费药与进口器材',
    feeType: 'per10W',
    fee: 38,
    priority: 8,
    conflictsWith: [],
  },
  {
    id: 'hospital-allowance',
    name: '意外住院津贴',
    description: '意外住院每日定额津贴',
    feeType: 'flat',
    fee: 100,
    priority: 4,
    conflictsWith: [],
    minAge: 18,
    maxAge: 60,
  },
  {
    id: 'critical',
    name: '重大疾病附加',
    description: '覆盖 120 种重大疾病，确诊即付',
    feeType: 'per10W',
    fee: 65,
    priority: 6,
    conflictsWith: [],
    minAge: 18,
    maxAge: 60,
  },
  {
    id: 'waiver',
    name: '保费豁免',
    description: '确诊重疾后豁免后续保费',
    feeType: 'flat',
    fee: 60,
    priority: 7,
    conflictsWith: [],
    minSumInsured: 300000,
  },
  {
    id: 'dental',
    name: '意外齿科医疗',
    description: '意外导致的齿科治疗费用报销',
    feeType: 'flat',
    fee: 80,
    priority: 2,
    conflictsWith: [],
  },
]

const B_DISCOUNTS: Discount[] = [
  {
    id: 'big-policy',
    name: '大额保单优惠',
    description: '保额达到 40 万，保费 95 折',
    priority: 20,
    factor: 0.95,
    condition: { type: 'sumInsuredAtLeast', value: 400000 },
  },
  {
    id: 'youth',
    name: '青年费率优惠',
    description: '18–28 周岁投保，保费 9 折',
    priority: 25,
    factor: 0.9,
    condition: { type: 'ageBetween', min: 18, max: 28 },
  },
  {
    id: 'online',
    name: '线上投保优惠',
    description: '线上投保且保额达到 10 万，保费 98 折',
    priority: 5,
    factor: 0.98,
    condition: { type: 'sumInsuredAtLeast', value: 100000 },
  },
]

export const RULESET_B: RuleSet = {
  id: 'B',
  name: '修订方案 B',
  description: '业务拟调整的下一版规则',
  minAge: 0,
  maxAge: 75,
  plans: B_PLANS,
  regions: B_REGIONS,
  ageBands: B_AGE_BANDS,
  riders: B_RIDERS,
  discounts: B_DISCOUNTS,
}

export const RULESETS: Record<string, RuleSet> = { A: RULESET_A, B: RULESET_B }

export function ruleSetName(id: string): string {
  return RULESETS[id]?.name ?? id
}

/* ================= 可选保额与默认输入 ================= */

export const SUM_INSURED_OPTIONS = [100000, 300000, 500000, 1000000]

export const DEFAULT_INPUT: QuoteInput = {
  age: 35,
  regionId: 'east',
  sumInsured: 300000,
  riderIds: [],
}
