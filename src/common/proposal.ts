// M4b 整理闭环——提案文件 schema + 手写校验守卫（主/渲染进程共用，纯函数零运行时依赖）。
// 本模块不 import fs/js-yaml：序列化归 T3（electron/main/bookStore/proposals.ts 经 docStore），
// 此处只钉结构与合法组合，保证 T3（门控）、T4（触发提示词）、T5（审阅面板徽章）共用单一权威。
//
// 校验口径（宽严分界，与 schema.ts 同风格）：
// - 结构必备字段存在 + 类型正确 + 枚举值在集合内 + 引用 id 匹配 UUID 形状（source.chapterId）；
// - op×entity 组合表钉死（ALLOWED_OPS，单一权威）——尤其 delete 仅限 plotline/choice/foreshadow：
//   角色/设定/章由人手写，AI 无权删（spec「分工铁律」）；
// - after/before 是 unknown：实体内容深校验发生在采纳期（T3 adopt 落盘前跑 schema.ts 对应校验器），
//   此处只查「该 op 是否必须携带 after / 该条目是否必须携带 targetId」；
// - source.quote：prompt 约定 ≤120 字，校验宽限到 ≤300 硬拦病理输出（trim 后空串拒绝）；
// - overwritesHuman 仅对 op=update 有意义（要求 boolean）；出现在 create/delete 上被忽略，不报错（宽容）；
// - file.chapterId 与 change.source.chapterId 是否一致、targetId 指向是否存在，均不校验
//   （引用完整性归 repository/T3）；未知多余字段一律容忍（向前兼容）；
// - ProposalFile.status 的 'pending'|'partial'|'settled' 迁移由 T3 管理，此处只查枚举归属；
// - appliedIndexes（T3 裁定追加）：可选字段，出现即要求「有限 number 数组」，语义清洗归 markSettled；
// - M4c-1 稳定变更标识：change.cid?（出现即非空字符串，文件内唯一）+ ProposalFile.appliedCids?
//   （出现即非空字符串数组）。记账主键 = changeKey()（本模块导出，唯一来源——引擎/面板/
//   markSettled/reject 全消费它，禁止第二处内联回退前缀字面量，grep 门钉在 proposal.test.ts）。
//   权威链：appliedCids 存在 → 键域唯一权威；纯 legacy 文件（从未双写）→ appliedIndexes 位置语义
//   （appliedKeySet() 单源翻译）。isUnsettled() = 未消化谓词单源（m4b 结转 d 项）。

import { UUID_PATTERN } from './schema'

// ---------------------------------------------------------------------------
// 类型与枚举（运行时校验用的数组 + 类型本体）
// ---------------------------------------------------------------------------

export type ProposalEntity =
  | 'character'
  | 'world'
  | 'plotline'
  | 'choice'
  | 'foreshadow'
  | 'summary'
  | 'index'

export type ProposalOp = 'create' | 'update' | 'delete'

export type ProposalStatus = 'pending' | 'partial' | 'settled'

export interface ProposalSource {
  chapterId: string
  quote: string
}

export interface ProposalChange {
  /**
   * 稳定变更标识（M4c-1）：整理链盖章 randomUUID，记账主键——重排/收缩后不动（changeKey 单源）。
   * 缺省合法（存量/第三方手写文件）：读者按 changeKey() 回退位置键。
   * 校验宽容：出现即要求非空字符串（不强制 UUID 形状）；同文件内重复 = 文件级错误（键域记账歧义）。
   */
  cid?: string
  op: ProposalOp
  entity: ProposalEntity
  /** update/delete 必备；create 忽略（可有可无，不落错）。 */
  targetId?: string
  /** 改动前状态快照，仅供审阅面板展示 diff；深校验在 T3 采纳期。 */
  before?: unknown
  /** create/update 必备；实体内容形状（unknown——采纳前经 schema.ts 对应校验器把深度关）。 */
  after?: unknown
  source: ProposalSource
  /** 仅 op=update 生效：允许覆盖 origin='human' 字段；其余 op 上被忽略。 */
  overwritesHuman?: boolean
}

export interface ProposalFile {
  id: string
  chapterId: string
  /** ISO 字符串（new Date().toISOString()）；js-yaml dump 会自动加引号防 Date 漂移。 */
  createdAt: string
  aiModel: string
  status: ProposalStatus
  changes: ProposalChange[]
  /**
   * 已采纳条目索引（T3 裁定）：由主进程 markSettled 在采纳后重写维护，缺失 = 尚无采纳。
   * status 迁移的单一依据：全部条目已采纳 → 'settled'、部分 → 'partial'、无 → 'pending'。
   * 校验器宽容：出现即要求「有限 number 数组」，越界/重复的清洗归 markSettled（存储侧）。
   * M4c-1 起 = appliedCids 对当前 changes 的位置投影（同一原子写双写，语义恒等，legacy 读者兼容）；
   * 纯 legacy 文件（从未双写 appliedCids）保持位置语义。
   */
  appliedIndexes?: number[]
  /**
   * 已采纳条目键记账（M4c-1，权威）：键 = changeKey(change, index)（cid ?? 位置回退键）。
   * 唯一写入口 = markSettled 双写（reject 同步收缩重算）。**一旦存在（含空数组）即成为
   * 「已采纳」判定的唯一权威**（appliedKeySet 忽略 appliedIndexes）；缺失 = 纯 legacy 位置语义。
   * 校验器宽容：出现即要求「非空字符串数组」，垃圾元素清洗归 loadProposalRaw（存储侧）。
   */
  appliedCids?: string[]
}

/** 采纳结果的拒绝条目（T3 adopt 引擎产出；reason 一律 `REFUSED: ` 前缀 + 中文/仓库错误码）。 */
export interface ProposalAdoptRefusal {
  /** changeKey 键域（M4c-1 起通道按键对账——位置漂移不再错配对号入座）。 */
  key: string
  reason: string
}

/** proposal:adopt 通道返回形状（渲染层差异面板按 key 对号入座）。 */
export interface ProposalAdoptResult {
  applied: string[]
  refused: ProposalAdoptRefusal[]
}

export const PROPOSAL_OPS: readonly ProposalOp[] = ['create', 'update', 'delete']
export const PROPOSAL_ENTITIES: readonly ProposalEntity[] = [
  'character',
  'world',
  'plotline',
  'choice',
  'foreshadow',
  'summary',
  'index'
]
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'partial', 'settled']

/**
 * op×entity 合法组合表——单一权威（T3 门控、T5 徽章渲染都读它，勿在他处复制）。
 * create：六个可新建实体（index 是派生总目录，只能 update）；
 * update：全部七类；
 * delete：仅 plotline/choice/foreshadow——角色/设定/章不级联删（spec 分工铁律：AI 无权删人写法）。
 */
export const ALLOWED_OPS: Record<ProposalEntity, ProposalOp[]> = {
  character: ['create', 'update'],
  world: ['create', 'update'],
  plotline: ['create', 'update', 'delete'],
  choice: ['create', 'update', 'delete'],
  foreshadow: ['create', 'update', 'delete'],
  summary: ['create', 'update'],
  index: ['update']
}

// ---------------------------------------------------------------------------
// M4c-1：记账主键与权威链（单源——引擎/面板/markSettled/reject 全消费，勿在他处复制；
// 回退前缀字面量全仓只许出现在本文件，grep 门钉在 proposal.test.ts）
// ---------------------------------------------------------------------------

/** 位置回退键前缀（仅 legacy/第三方无 cid 条目；回退键 = 前缀 + index）。 */
const IDX_KEY_PREFIX = 'idx:'

/**
 * 记账主键（唯一来源）：cid 为非空字符串 → cid（重排/收缩不动——本次重构的存在理由）；
 * 否则 → 位置回退键（legacy/第三方无 cid 条目，语义与旧位置世界一致）。
 * 入参刻意宽容（unknown）：adopt/reject 引擎消费 loadProposalRaw 的 unknown[]，
 * 退化形状（非对象 / cid 类型漂移 / 空串）一律回退位置键——绝不产出非 string 键，
 * 此类条目随后会被 validateChange 逐条拒（对 plan 公式 `c.cid ?? 'idx:'+i` 的从严细化，
 * 合法文件上二者语义全等）。
 * M4c-2 T6 结转：cid 先 trim 再入键域——首尾空白（YAML 手改/第三方导出常见）不再制造
 * 「同一账目身份的两个键」；全空白视同空串 → 位置回退（与 validateChange 的 trim 判定同口径）。
 */
export function changeKey(c: unknown, index: number): string {
  const cid = isRecord(c) ? c.cid : undefined
  const trimmed = typeof cid === 'string' ? cid.trim() : ''
  return trimmed !== '' ? trimmed : `${IDX_KEY_PREFIX}${index}`
}

/**
 * 已采纳条目的键集合（权威链单源：引擎「已采纳」守卫 / 面板灰化 / 徽章计数共用）。
 * - appliedCids 存在（含空数组）→ 键域唯一权威（appliedIndexes 忽略——双写一致性由
 *   markSettled/reject 在同一原子写里保证；第三方只写 appliedCids 也被接受）；
 * - 纯 legacy 文件（从未双写）→ appliedIndexes 按位置翻译成键域（有 cid 翻 cid、无 cid 翻
 *   回退键；越界/非整数索引不投影——旧 appliedInRangeCount 的宽容口径）。
 */
export function appliedKeySet(file: {
  changes: unknown[]
  appliedCids?: string[]
  appliedIndexes?: number[]
}): Set<string> {
  if (file.appliedCids !== undefined) return new Set(file.appliedCids)
  const s = new Set<string>()
  for (const i of file.appliedIndexes ?? []) {
    if (Number.isInteger(i) && i >= 0 && i < file.changes.length) s.add(changeKey(file.changes[i], i))
  }
  return s
}

/** 「未消化」谓词单源（m4b 结转 d 项）：徽章计数 / 面板列表过滤 / PROPOSAL_DUPLICATE 闸门共用。 */
export function isUnsettled(p: { status: string }): boolean {
  return p.status !== 'settled'
}

// ---------------------------------------------------------------------------
// 校验守卫工具（错误串带字段路径，调用方按字段名做子串匹配——同 schema.ts 口径）
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

/** source.quote 长度上限：prompt 约定 120，硬拦 300（防病理输出，宽容于 AI 越界一截）。 */
export const QUOTE_MAX_LENGTH = 300

// ---------------------------------------------------------------------------
// 校验器：返回 string[]，空数组 = 合法
// ---------------------------------------------------------------------------

/** 条目级校验：op×entity 组合表 + 各 op 必备字段 + source 深结构。 */
export function validateChange(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['change: expected object, got ' + typeName(v)]

  expectEnum(v, 'op', 'change.op', PROPOSAL_OPS, errors)
  expectEnum(v, 'entity', 'change.entity', PROPOSAL_ENTITIES, errors)

  const op = v.op
  const entity = v.entity
  const opValid = typeof op === 'string' && PROPOSAL_OPS.includes(op as ProposalOp)
  const entityValid = typeof entity === 'string' && PROPOSAL_ENTITIES.includes(entity as ProposalEntity)

  // 组合表门控（op 与 entity 均合法时才有意义）
  if (opValid && entityValid) {
    const allowed = ALLOWED_OPS[entity as ProposalEntity]
    if (!allowed.includes(op as ProposalOp)) {
      errors.push(
        `change: op "${op}" is not allowed for entity "${entity}" (allowed ops: ${allowed.join(', ')})`
      )
    }
  }

  // targetId：update/delete 必备（非空字符串；指向是否存在归 repository）；create 上忽略
  if (opValid && (op === 'update' || op === 'delete')) {
    expectString(v, 'targetId', 'change.targetId', errors, true)
  }

  // after：create/update 必备（值本身是 unknown——深校验在 T3 采纳期）；delete 上忽略
  if (opValid && (op === 'create' || op === 'update')) {
    if (!('after' in v) || v.after === undefined) {
      errors.push(`change.after: required payload for op "${op}" (value itself is unknown here)`)
    }
  }

  // before：可选快照，出现即容忍（unknown，无结构要求）

  // overwritesHuman：仅 update 生效且必须是 boolean；其他 op 上出现被忽略（宽容）
  if (v.overwritesHuman !== undefined && op === 'update') {
    if (typeof v.overwritesHuman !== 'boolean') {
      errors.push(`change.overwritesHuman: expected boolean, got ${typeName(v.overwritesHuman)}`)
    }
  }

  // cid（M4c-1）：缺省合法（存量/第三方手写文件常态）；出现即非空字符串——不强制 UUID 形状
  // （盖章产出恒 UUID，手写留自由度）。同文件唯一性归 validateProposal（文件级错误）。
  if (v.cid !== undefined) {
    expectString(v, 'cid', 'change.cid', errors, true)
    // M4c-2 T6 结转：以位置回退键前缀开头的 cid（trim 后判定——changeKey 同口径）一律拒——
    // `idx:〈n〉` 是回退读者的私有身份，允许入存就出现「伪 cid 与真回退键同键双条目」的
    // 记账歧义（采纳/灰化/徽章全错位）。盖章产出恒 UUID，天然不受影响。
    if (typeof v.cid === 'string' && v.cid.trim().startsWith(IDX_KEY_PREFIX)) {
      errors.push(`change.cid: must not start with "${IDX_KEY_PREFIX}" (reserved positional fallback prefix)`)
    }
  }

  // source：必备对象，chapterId UUID 形状、quote 非空且 ≤ QUOTE_MAX_LENGTH
  const source = v.source
  if (!isRecord(source)) {
    errors.push(`change.source: expected object, got ${typeName(source)}`)
  } else {
    expectUuid(source, 'chapterId', 'change.source.chapterId', errors)
    const quote = source.quote
    if (typeof quote !== 'string') {
      errors.push(`change.source.quote: expected string, got ${typeName(quote)}`)
    } else if (quote.trim() === '') {
      errors.push('change.source.quote: expected non-empty string')
    } else if (quote.length > QUOTE_MAX_LENGTH) {
      errors.push(
        `change.source.quote: expected at most ${QUOTE_MAX_LENGTH} chars, got ${quote.length}`
      )
    }
  }

  return errors
}

/** 把条目级错误包一层父路径，使错误串同时含 changes 与索引（同 schema.ts childErrors 风格）。 */
function childErrors(index: number, inner: Errors): Errors {
  return inner.map((e) => `proposal.changes[${index}]: ${e}`)
}

/** 文件级校验：必填/枚举/changes 非空数组 + 逐条下钻 validateChange。 */
export function validateProposal(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['proposal: expected object, got ' + typeName(v)]

  expectString(v, 'id', 'proposal.id', errors, true)
  expectUuid(v, 'chapterId', 'proposal.chapterId', errors)
  expectString(v, 'createdAt', 'proposal.createdAt', errors)
  expectString(v, 'aiModel', 'proposal.aiModel', errors, true)
  expectEnum(v, 'status', 'proposal.status', PROPOSAL_STATUSES, errors)

  const changes = v.changes
  if (!Array.isArray(changes)) {
    errors.push(`proposal.changes: expected array, got ${typeName(changes)}`)
  } else {
    if (changes.length === 0) {
      errors.push('proposal.changes: expected non-empty array, got 0 items')
    }
    const seenCids = new Set<string>()
    changes.forEach((item, i) => {
      errors.push(...childErrors(i, validateChange(item)))
      // cid 文件内唯一（M4c-1）：重复 cid 让键域记账歧义（一键双条目 = 采纳/灰化全部错位），
      // 文件级拒绝。cid 类型漂移已由 validateChange 逐条报——这里只收合法字符串。
      // M4c-2 T6 结转：判重按 trim 后值（changeKey 归一同款口径）——仅空白之差的两个 cid
      // 归一后即同键，必须在这里就拒，不能放进盘上。
      if (isRecord(item) && typeof item.cid === 'string' && item.cid.trim() !== '') {
        const cidKey = item.cid.trim()
        if (seenCids.has(cidKey)) {
          errors.push(`proposal.changes: duplicate cid "${cidKey}" (cid must be unique within a file)`)
        } else {
          seenCids.add(cidKey)
        }
      }
    })
  }

  // appliedIndexes：可选（T3 markSettled 维护）；出现即要求「有限 number 数组」——
  // 越界/重复/非整数的清洗归存储侧（markSettled），此处只拦类型漂移
  const applied = v.appliedIndexes
  if (applied !== undefined) {
    if (!Array.isArray(applied)) {
      errors.push(`proposal.appliedIndexes: expected array, got ${typeName(applied)}`)
    } else if (applied.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      errors.push('proposal.appliedIndexes: expected array of finite numbers')
    }
  }

  // appliedCids：可选（M4c-1 markSettled 双写）；出现即要求「非空字符串数组」——
  // 键域垃圾（数字/空串）会混进权威账目，形状级拒掉；未知键/去重的清洗归存储侧
  const appliedCids = v.appliedCids
  if (appliedCids !== undefined) {
    if (!Array.isArray(appliedCids)) {
      errors.push(`proposal.appliedCids: expected array, got ${typeName(appliedCids)}`)
    } else if (appliedCids.some((x) => typeof x !== 'string' || x === '')) {
      errors.push('proposal.appliedCids: expected array of non-empty strings')
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// 路径与 ID 纯函数（无 fs；主/渲染均可安全 import）
// ---------------------------------------------------------------------------

/** 提案目录（相对书根）。与 paths.ts 的实体目录同级，`.ai/` 命名空间归 AI 产物。 */
export const PROPOSALS_DIR = '.ai/proposals'

/** 纯字符串拼接 `<bookDir>/.ai/proposals/<id>.yaml`（bookDir 尾部分隔符归一；主进程落盘走 docStore 原子写）。 */
export function proposalPath(bookDir: string, id: string): string {
  const base = bookDir.replace(/[\\/]+$/, '')
  const rel = `${PROPOSALS_DIR}/${id}.yaml`
  return base ? `${base}/${rel}` : rel
}

/** `prop-<chapterId 前 8 位>-<ts 的 36 进制>`；ts 注入参数使测试确定性。 */
export function newProposalId(chapterId: string, ts: number): string {
  return `prop-${chapterId.slice(0, 8)}-${ts.toString(36)}`
}
