// AI 整理提案仓库（M4b T3）：`.ai/proposals/<id>.yaml` = ProposalFile（docStore 原子写）。
// 主进程代码：相对导入 + node: 前缀。守卫/容错纪律镜像五实体仓库（chapters/characters/…）：
// - listProposals 单档损坏 console.warn（绝对路径）+ 跳过，绝不整体抛（一本坏提案不让面板瘫痪）；
//   按 createdAt 升序（同刻按 id 稳定）；
// - 文件名（stem）即 id 的唯一权威：读侧以 stem 覆写内容 id 字段，写侧路径 = proposalPath(p, file.id)；
// - 点读分工同实体仓库：getProposal 缺失 → null、坏档/结构非法 → `PROPOSAL_INVALID: <abs>: …` 抛穿；
//   list 侧才容错。writeProposal 写前一律 validateProposal（坏形状 → `PROPOSAL_INVALID: <id>: …`，
//   整份拒落零字节——「不落半套」全局约束）；
// - 路径安全门：提案 id 不是 UUID（`prop-<chapterId前8>-<ts36>`，T1 newProposalId 生产者），
//   但同样经 join 拼路径——`../` 重定向风险与实体仓库一致。凡 id 含路径分隔符/控制字符、
//   或为 '.'/'..'/空串 → `BAD_PROPOSAL_ID: <id>` 抛（deleteProposal 按幂等契约返回 false 不抛，
//   与五仓库同一契约分裂）；
// - markSettled 是 appliedIndexes + status 的唯一写入口（控制器裁定）：applied 追踪存文件内
//   （appliedIndexes?: number[]，src/common/proposal.ts 已扩类型 + 校验宽容），每次采纳后
//   合并重写；status 一律由 computeProposalStatus 从「剩余条目」重算，绝不接受调用方口述；
// - loadProposalRaw 是 adopt/reject 引擎的宽容装载口：只查结构（对象 + changes 数组），
//   不做文件级 validateProposal——逐条深校验（validateChange 双保险）发生在 adopt 采纳现场，
//   坏条目按条拒绝而不是整份提案不可操作（T1 交接：手改坏文件也要能救出好条目）；
// - R2 纪律（__proto__ 加固）：信封一律显式字段重建（rebuildEnvelope），绝不 spread 解析产物；
//   js-yaml load 对 `__proto__:` 键产生 own property（实验证实不污染原型），显式重建 + 引擎侧
//   allowlist 双保险把该键挡在任何落盘对象之外。
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ProposalFile, ProposalStatus } from '../../../src/common/proposal'
import { PROPOSAL_STATUSES, proposalPath, validateProposal } from '../../../src/common/proposal'
import { proposalsDir } from './paths'
import { listYamlFiles, noteSelfWrite, readYamlFile, writeYamlFileAtomic } from './docStore'

const YAML_EXT = '.yaml'

/**
 * 宽容装载产物（adopt/reject 引擎的工作形状）：
 * - changes 保持 unknown[]——每条在采纳现场必须先过 validateChange 再按类型消费；
 * - appliedIndexes 已清洗（整数、去重、升序、界内）；
 * - status 非法枚举强制回 'pending'（storage 侧自愈，绝不把垃圾枚举写回）。
 */
export interface RawProposal {
  id: string
  chapterId: string
  createdAt: string
  aiModel: string
  status: ProposalStatus
  changes: unknown[]
  appliedIndexes: number[]
}

/** createdAt 升序（同刻按 id 稳定）——镜像五实体仓库的 list 排序纪律。 */
function byCreatedAt(a: ProposalFile, b: ProposalFile): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/**
 * id 路径安全门（镜像 assertCharacterId 的动机）：提案 id 由 newProposalId 生产时为
 * `prop-<hex8>-<base36>`（纯 [A-Za-z0-9-]），但 get/write/delete 接受第三方文件名——
 * 分隔符 / NUL / 控制字符 / '.' / '..' / 空串一律拒绝，封死 join 路径重定向。
 */
function isUnsafeProposalId(id: unknown): boolean {
  if (typeof id !== 'string' || id === '' || id === '.' || id === '..') return true
  // eslint-disable-next-line no-control-regex
  return /[\\/]|[<>:"|?*]/.test(id) || /[\x00-\x1f]/.test(id)
}

function assertProposalId(id: unknown): void {
  if (isUnsafeProposalId(id)) {
    throw new Error(`BAD_PROPOSAL_ID: ${String(id)}`)
  }
}

// ---------------------------------------------------------------------------
// 读侧
// ---------------------------------------------------------------------------

/** 严格解析单档（getProposal/listProposals 共用）：坏字节/结构非法 → PROPOSAL_INVALID 抛穿。 */
function parseStrict(abs: string, stem: string): ProposalFile {
  let v: unknown
  try {
    v = readYamlFile<unknown>(abs) // 缺档 ENOBOOK / 坏字节 YAMLException 都在下方统一包装
  } catch (err) {
    throw new Error(
      `PROPOSAL_INVALID: ${abs}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const errors = validateProposal(v)
  if (errors.length > 0) {
    throw new Error(`PROPOSAL_INVALID: ${abs}: ${errors.join('; ')}`)
  }
  const doc = v as ProposalFile
  // R2：显式字段重建（绝不 spread 解析产物）；stem 权威覆写内容 id
  const file: ProposalFile = {
    id: stem,
    chapterId: doc.chapterId,
    createdAt: doc.createdAt,
    aiModel: doc.aiModel,
    status: doc.status,
    changes: doc.changes
  }
  if (doc.appliedIndexes !== undefined) file.appliedIndexes = doc.appliedIndexes
  return file
}

/**
 * 全部提案（createdAt 升序）；坏档 warn（绝对路径）+ 跳过；目录缺失 → []。
 * 只认 *.yaml（listYamlFiles 口径，`.tmp-` 瞬态天然被忽略）。
 */
export function listProposals(p: string): ProposalFile[] {
  const dir = proposalsDir(p)
  const files: ProposalFile[] = []
  for (const name of listYamlFiles(dir)) {
    const abs = join(dir, name)
    try {
      files.push(parseStrict(abs, name.slice(0, -YAML_EXT.length)))
    } catch (err) {
      console.warn(`跳过损坏提案文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return files.sort(byCreatedAt)
}

/** 点读单份：缺失 → null；坏档 → PROPOSAL_INVALID 抛穿；坏形状 id → BAD_PROPOSAL_ID 抛。 */
export function getProposal(p: string, id: string): ProposalFile | null {
  assertProposalId(id)
  const abs = proposalPath(p, id)
  if (!existsSync(abs)) return null
  return parseStrict(abs, id)
}

// ---------------------------------------------------------------------------
// 写侧
// ---------------------------------------------------------------------------

/**
 * 落盘一份提案（validateProposal 前置——整份拒落零字节）；返回入参 file（id 来自 file）。
 * 通道层（proposal:save）在此之前另有 chapterId 盖章检查——存储层不重复该职责。
 */
export function writeProposal(p: string, file: ProposalFile): ProposalFile {
  assertProposalId(file?.id)
  const errors = validateProposal(file)
  if (errors.length > 0) {
    throw new Error(`PROPOSAL_INVALID: ${file.id}: ${errors.join('; ')}`)
  }
  writeYamlFileAtomic(proposalPath(p, file.id), file)
  return file
}

/** 删除提案：坏形状/缺失 → false 不抛（幂等契约镜像 deleteCharacter）；真实删除失败抛穿。 */
export function deleteProposal(p: string, id: string): boolean {
  if (isUnsafeProposalId(id)) return false
  const abs = proposalPath(p, id)
  if (!existsSync(abs)) return false
  unlinkSync(abs)
  noteSelfWrite(abs) // I1：自删登记（watcher 对 .ai/ 本就忽略，登记保持纪律一致）
  return true
}

// ---------------------------------------------------------------------------
// applied 追踪与 status 迁移（markSettled 唯一写入口）
// ---------------------------------------------------------------------------

/** 清洗 appliedIndexes：只留 [0, changesCount) 内整数，去重升序（非数组 → []）。 */
export function sanitizeAppliedIndexes(v: unknown, changesCount: number): number[] {
  if (!Array.isArray(v)) return []
  const clean = new Set<number>()
  for (const x of v) {
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < changesCount) clean.add(x)
  }
  return [...clean].sort((a, b) => a - b)
}

/** status 单一计算口径：全清 → settled；有采纳但有余 → partial；无采纳 → pending。 */
export function computeProposalStatus(changesCount: number, appliedCount: number): ProposalStatus {
  if (appliedCount >= changesCount) return 'settled'
  if (appliedCount > 0) return 'partial'
  return 'pending'
}

/**
 * 宽容装载（adopt/reject 专用）：结构门 = 对象 + changes 数组，其余字段逐个类型 coercion，
 * 坏字节/结构坏 → PROPOSAL_INVALID、缺失 → PROPOSAL_MISSING、坏 id → BAD_PROPOSAL_ID。
 * 逐条 validateChange 深校验刻意不在此处——归 adopt 采纳现场（坏条目按条拒，好条目照救）。
 */
export function loadProposalRaw(p: string, id: string): { proposal: RawProposal; abs: string } {
  assertProposalId(id)
  const abs = proposalPath(p, id)
  if (!existsSync(abs)) {
    throw new Error(`PROPOSAL_MISSING: ${id}`)
  }
  let v: unknown
  try {
    v = readYamlFile<unknown>(abs)
  } catch (err) {
    throw new Error(
      `PROPOSAL_INVALID: ${abs}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`PROPOSAL_INVALID: ${abs}: expected object`)
  }
  const doc = v as Record<string, unknown>
  if (!Array.isArray(doc.changes)) {
    throw new Error(`PROPOSAL_INVALID: ${abs}: changes must be an array`)
  }
  const status = PROPOSAL_STATUSES.includes(doc.status as ProposalStatus)
    ? (doc.status as ProposalStatus)
    : 'pending' // 垃圾枚举自愈回 pending（迁移由 markSettled 重算，绝不写回垃圾）
  const proposal: RawProposal = {
    id, // stem 权威
    chapterId: typeof doc.chapterId === 'string' ? doc.chapterId : '',
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : '',
    aiModel: typeof doc.aiModel === 'string' ? doc.aiModel : '',
    status,
    changes: doc.changes,
    appliedIndexes: sanitizeAppliedIndexes(doc.appliedIndexes, doc.changes.length)
  }
  return { proposal, abs }
}

/**
 * RawProposal 的唯一落盘口（markSettled/rejectChanges 共用）：显式字段重建信封（R2——
 * 绝不 spread 解析产物），appliedIndexes 仅在非空时携键（缺失 = 尚无采纳，与存量文件同形）。
 */
export function saveProposalRaw(p: string, proposal: RawProposal): void {
  const envelope: Record<string, unknown> = {
    id: proposal.id,
    chapterId: proposal.chapterId,
    createdAt: proposal.createdAt,
    aiModel: proposal.aiModel,
    status: proposal.status,
    changes: proposal.changes
  }
  if (proposal.appliedIndexes.length > 0) envelope.appliedIndexes = proposal.appliedIndexes
  writeYamlFileAtomic(proposalPath(p, proposal.id), envelope)
}

/**
 * 采纳后的记账唯一入口（控制器裁定）：合并 newlyApplied 进文件内 appliedIndexes，
 * 由「剩余条目」重算 status（全部已采纳 → settled、部分 → partial、无 → pending），原子重写。
 * 返回重算后的 status。缺失文件 → PROPOSAL_MISSING 抛（记账失败必须响亮——静默丢 applied
 * 追踪会导致重采纳双写，宁可让通道报错）。
 */
export function markSettled(p: string, id: string, newlyApplied: number[] = []): ProposalStatus {
  const { proposal } = loadProposalRaw(p, id)
  const merged = sanitizeAppliedIndexes(
    [...proposal.appliedIndexes, ...newlyApplied],
    proposal.changes.length
  )
  const next: RawProposal = {
    id: proposal.id,
    chapterId: proposal.chapterId,
    createdAt: proposal.createdAt,
    aiModel: proposal.aiModel,
    status: computeProposalStatus(proposal.changes.length, merged.length),
    changes: proposal.changes,
    appliedIndexes: merged
  }
  saveProposalRaw(p, next)
  return next.status
}
