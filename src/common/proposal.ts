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
// - ProposalFile.status 的 'pending'|'partial'|'settled' 迁移由 T3 管理，此处只查枚举归属。

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
    changes.forEach((item, i) => errors.push(...childErrors(i, validateChange(item))))
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
