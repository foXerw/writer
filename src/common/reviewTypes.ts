// M6 章节审阅——意见 schema + 锚重定位 + 驳回抑制键（主/渲染进程共用，纯函数零运行时依赖）。
// 序列化归 electron/main/bookStore/reviews.ts（`.ai/reviews/<chapterId>.json` 单文件 JSON 数组），
// 此处只钉结构与信任语义，保证 T2（解析）、T4（转化）、T5（编排/渲染）共用单一权威。
//
// 校验口径（宽严分界，与 proposal.ts 同款）：
// - 严格写自家产物：saveRun/通道落盘前每条意见必须过 validateReviewOpinion——
//   status 三值钉死 + stale 布尔钉死（stale 是 open 的标记位、非第四枚举，spec Q4 拍板），
//   六类白名单 + severity×类别配对表（severity 是类别的投影，不是第二自由度）；
// - 宽容读：仓库层 loadReviews 逐条过滤坏意见（warn+skip），向前兼容——未知多余字段一律容忍；
// - anchor.quote：prompt 约定 ≤40 字，校验宽限到 REVIEW_QUOTE_MAX_LENGTH 硬拦病理输出（trim 后空串拒绝）；
// - chapterId 钉 UUID 形状（同 proposal.source.chapterId）——它同时是账本文件名，路径安全在仓库层再钉一道。
//
// 信任语义（为什么这么设计）：
// - suppressionKey = 「chapterId+类别+归一化引文哈希」——dismissed 抑制**同章生效**（spec Q6 修订：
//   全书生效会吞掉他章真实同类意见，反方向数据丢失）；防「重审复读已驳回」= 防信任破产；
//   paraIndex 刻意不入键——锚漂移后驳回仍有效（作者驳回的是「这条意见」，不是「这个段号」）；
// - normalizeQuote = 去所有空白 + 全角 ASCII（FF01–FF5E）转半角：模型复读同一处时标点宽度/换行
//   折行几乎必然漂移，归一化让「同一句话的两种写法」塌缩到同一个抑制键；U+3000 属 \s 直接剥除；
// - relocateAnchor 三态：段内命中 → 段号原样回报；漂移 → 全文按序搜到真实段；彻底找不到 →
//   found:false（反目标：锚失必须显式，绝不错位高亮）。段按空行切（`\n\n`，CRLF 宽容，
//   段按空行切，organizePrompt 引文逐字铁律的段落口径 + export.ts /\n{2,}/ 先例的 CRLF 加固版）；
//   startOffset/endOffset
//   是**原始 body 坐标系**的 UTF-16 码元区间（归一化只用于匹配，回射用映射表复原含空白原文）。

import { UUID_PATTERN } from './schema'

// ---------------------------------------------------------------------------
// 类型与枚举（运行时校验用的数组 + 类型本体）
// ---------------------------------------------------------------------------

export type ReviewCategory =
  | 'foreshadow-unresolved'
  | 'setting-conflict'
  | 'motivation-break'
  | 'pacing'
  | 'flatness'
  | 'prose-craft'

export type ReviewSeverity = 'hard' | 'soft'

export type ReviewStatus = 'open' | 'dismissed' | 'converted'

export interface ReviewAnchor {
  /** 引文片段（prompt 约定 ≤40 字，逐字取自正文——归一化后才参与匹配）。 */
  quote: string
  /** 段落序号（0 起，正文按空行分段）。锚漂移时仅作重定位提示，非权威。 */
  paraIndex: number
}

export interface ReviewOpinion {
  id: string
  chapterId: string
  category: ReviewCategory
  severity: ReviewSeverity
  anchor: ReviewAnchor
  text: string
  suggestion?: string
  /** 涉事实体 id（模型确信时给出；转化期校验+选择器兜底归 T4/T5，此处只查形状）。 */
  targetEntityId?: string
  status: ReviewStatus
  /** 「上次未重现」标记位（仅对 status=open 有意义；非第四枚举，spec Q4）。 */
  stale: boolean
  createdAt: string
  model: string
  /** converted 的转化指针（markReviewConverted 唯一写入口）。 */
  proposalId?: string
}

/** 硬对账三类（伏笔未回收/设定冲突/动机断裂）——动作集 {驳回, 转提案}。 */
export const HARD_CATEGORIES: readonly ReviewCategory[] = [
  'foreshadow-unresolved',
  'setting-conflict',
  'motivation-break'
]

/** 软感受三类（节奏/扁平/文笔）——动作集 {驳回}，散文是作者地盘（spec 非目标）。 */
export const SOFT_CATEGORIES: readonly ReviewCategory[] = ['pacing', 'flatness', 'prose-craft']

export const REVIEW_CATEGORIES: readonly ReviewCategory[] = [
  ...HARD_CATEGORIES,
  ...SOFT_CATEGORIES
]

export const REVIEW_SEVERITIES: readonly ReviewSeverity[] = ['hard', 'soft']

/** status 恒三值——stale 是标记位不是枚举（校验器钉死，测试同锁）。 */
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['open', 'dismissed', 'converted']

/** anchor.quote 长度上限：prompt 约定 40，宽限 3× = 120 硬拦病理输出（QUOTE_MAX_LENGTH 同款姿态）。 */
export const REVIEW_QUOTE_MAX_LENGTH = 120

/** severity 是类别的投影（配对表单源——T2 解析盖章与校验共用，勿在他处复制）。 */
export function severityFor(category: ReviewCategory): ReviewSeverity {
  return HARD_CATEGORIES.includes(category) ? 'hard' : 'soft'
}

// ---------------------------------------------------------------------------
// 校验守卫工具（镜像 proposal.ts 私有 helper 口径——那边刻意未导出，此处独立小抄一份）
// ---------------------------------------------------------------------------

type Errors = string[]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function expectString(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  errors: Errors,
  nonEmpty = false
): void {
  const value = obj[field]
  if (typeof value !== 'string') {
    errors.push(`${path}: expected string, got ${typeName(value)}`)
    return
  }
  if (nonEmpty && value.trim() === '') {
    errors.push(`${path}: expected non-empty string`)
  }
}

function expectUuid(obj: Record<string, unknown>, field: string, path: string, errors: Errors): void {
  const value = obj[field]
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    errors.push(`${path}: expected UUID string, got ${typeName(value)}`)
  }
}

function expectEnum(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  allowed: readonly string[],
  errors: Errors
): void {
  const value = obj[field]
  if (typeof value !== 'string' || !allowed.includes(value)) {
    errors.push(`${path}: expected one of [${allowed.join(', ')}], got ${typeName(value)}`)
  }
}

// ---------------------------------------------------------------------------
// validateReviewOpinion：单条意见校验，返回 string[]，空数组 = 合法
// ---------------------------------------------------------------------------

export function validateReviewOpinion(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['opinion: expected object, got ' + typeName(v)]

  expectString(v, 'id', 'opinion.id', errors, true)
  expectUuid(v, 'chapterId', 'opinion.chapterId', errors)
  expectEnum(v, 'category', 'opinion.category', REVIEW_CATEGORIES, errors)
  expectEnum(v, 'severity', 'opinion.severity', REVIEW_SEVERITIES, errors)

  // severity×类别配对（两枚举都合法时才有意义，同 ALLOWED_OPS 组合表门控姿态）
  if (
    typeof v.category === 'string' &&
    REVIEW_CATEGORIES.includes(v.category as ReviewCategory) &&
    typeof v.severity === 'string' &&
    REVIEW_SEVERITIES.includes(v.severity as ReviewSeverity)
  ) {
    const expected = severityFor(v.category as ReviewCategory)
    if (v.severity !== expected) {
      errors.push(
        `opinion.severity: expected "${expected}" for category "${v.category}" (severity is a projection of category)`
      )
    }
  }

  // anchor：必备对象；quote 非空（trim 后）且 ≤ REVIEW_QUOTE_MAX_LENGTH；paraIndex 有限非负整数
  const anchor = v.anchor
  if (!isRecord(anchor)) {
    errors.push(`opinion.anchor: expected object, got ${typeName(anchor)}`)
  } else {
    const quote = anchor.quote
    if (typeof quote !== 'string') {
      errors.push(`opinion.anchor.quote: expected string, got ${typeName(quote)}`)
    } else if (quote.trim() === '') {
      errors.push('opinion.anchor.quote: expected non-empty string')
    } else if (quote.length > REVIEW_QUOTE_MAX_LENGTH) {
      errors.push(
        `opinion.anchor.quote: expected at most ${REVIEW_QUOTE_MAX_LENGTH} chars, got ${quote.length}`
      )
    }
    const paraIndex = anchor.paraIndex
    if (typeof paraIndex !== 'number' || !Number.isInteger(paraIndex) || paraIndex < 0) {
      errors.push(`opinion.anchor.paraIndex: expected non-negative integer, got ${typeName(paraIndex)}`)
    }
  }

  expectString(v, 'text', 'opinion.text', errors, true)

  // 可选字段：缺席合法；出现即查形状（targetEntityId/proposalId 指向是否存在归 T4/仓库，此处不查）
  if (v.suggestion !== undefined && typeof v.suggestion !== 'string') {
    errors.push(`opinion.suggestion: expected string, got ${typeName(v.suggestion)}`)
  }
  if (v.targetEntityId !== undefined) {
    expectString(v, 'targetEntityId', 'opinion.targetEntityId', errors, true)
  }
  if (v.proposalId !== undefined) {
    expectString(v, 'proposalId', 'opinion.proposalId', errors, true)
  }

  expectEnum(v, 'status', 'opinion.status', REVIEW_STATUSES, errors)

  // stale 布尔钉死：缺席/字符串/数字一律拒——重审替换与徽标计数全依赖此位，绝不默认 false 蒙混
  if (typeof v.stale !== 'boolean') {
    errors.push(`opinion.stale: expected boolean, got ${typeName(v.stale)}`)
  }

  expectString(v, 'createdAt', 'opinion.createdAt', errors)
  expectString(v, 'model', 'opinion.model', errors, true)

  return errors
}

// ---------------------------------------------------------------------------
// normalizeQuote + suppressionKey（驳回抑制 = 防复读的信任契约，spec Q6：同章生效）
// ---------------------------------------------------------------------------

/**
 * 归一化 + 位置回射（内部单源）：剥所有空白（\s 含 U+00A0/U+3000 全角空格）+
 * 全角 ASCII（U+FF01–U+FF5E）转半角；map[i] = 归一文本第 i 个码元在原文中的下标。
 * 逐 UTF-16 码元迭代（代理对两半都不匹配 \s/FF 区间，原样保留，offset 语义恒自洽）。
 */
function normalizeWithMap(s: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (/\s/.test(ch)) continue
    const code = s.charCodeAt(i)
    out += code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : ch
    map.push(i)
  }
  return { text: out, map }
}

/** 归一化引文（suppressionKey 与 relocateAnchor 的共同底座）。 */
export function normalizeQuote(quote: string): string {
  return typeof quote === 'string' ? normalizeWithMap(quote).text : ''
}

/** FNV-1a 32 位（非加密、确定性、零依赖）——抑制键尾段的短哈希。 */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 抑制键 = `chapterId|category|hash(normalizeQuote(quote))`。
 * 入参刻意结构化宽松（T2：parsed 半成品与自家产物共用同一把键）；
 * anchor.paraIndex 可携但**不入键**（锚漂移不废驳回）、跨章不抑制（spec Q6 修订钉）。
 */
export function suppressionKey(o: {
  chapterId: string
  category: ReviewCategory
  anchor: { quote: string; paraIndex?: number }
}): string {
  return `${o.chapterId}|${o.category}|${fnv1a32(normalizeQuote(o.anchor.quote))}`
}

// ---------------------------------------------------------------------------
// relocateAnchor：锚重定位（渲染期逐条决「命中/锚已失」，G3 跳转高亮的唯一算法权威）
// ---------------------------------------------------------------------------

/** 段 = { 原文文本, 在 body 中的起始码元下标 }；空行（连续 ≥2 个换行单元）分段。 */
function paragraphsOf(body: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  // 换行单元 = \r\n | \r | \n，连续 ≥2 个即空行分段（CRLF 书的 `\r\n\r\n` 是两个单元——
  // 刻意不用 /\r?\n{2,}/：那要求连续裸 \n，对 CRLF 正文整体失配）
  const sep = /(?:\r\n|\r|\n){2,}/g
  let start = 0
  let m: RegExpExecArray | null
  while ((m = sep.exec(body)) !== null) {
    out.push({ text: body.slice(start, m.index), start })
    start = m.index + m[0].length
  }
  out.push({ text: body.slice(start), start })
  return out
}

export type RelocateResult =
  | { found: true; paraIndex: number; startOffset: number; endOffset: number }
  | { found: false }

/**
 * 三态重定位：
 * 1. 先按 anchor.paraIndex 段内找归一化引文（命中 → 段号原样回报）；
 * 2. 失败则全文按段序搜（命中 → 回报**真实**段号；越界提示退化到此路径）；
 * 3. 都不中 → { found: false }（渲染「锚已失」灰态，可驳回可转化但跳转禁用——绝不错位高亮）。
 * startOffset/endOffset 为原始 body 坐标系的半开区间（回射经 normalizeWithMap 位置表，
 * 覆盖原文含空白/全角的完整跨度，slice 即得可高亮原文）。
 */
export function relocateAnchor(
  body: string,
  anchor: { quote: string; paraIndex: number }
): RelocateResult {
  if (typeof body !== 'string' || body === '') return { found: false }
  const needle = normalizeQuote(anchor?.quote ?? '')
  if (needle === '') return { found: false }
  const paras = paragraphsOf(body)

  const hit = (i: number): RelocateResult | null => {
    const { text, map } = normalizeWithMap(paras[i].text)
    const at = text.indexOf(needle)
    if (at === -1) return null
    return {
      found: true,
      paraIndex: i,
      startOffset: paras[i].start + map[at],
      endOffset: paras[i].start + map[at + needle.length - 1] + 1
    }
  }

  // 段内优先（段号正确时命中最快，且同文多段歧义下尊重作者所见）
  const hint = anchor?.paraIndex
  if (Number.isInteger(hint) && hint >= 0 && hint < paras.length) {
    const r = hit(hint)
    if (r) return r
  }
  for (let i = 0; i < paras.length; i++) {
    const r = hit(i)
    if (r) return r
  }
  return { found: false }
}
