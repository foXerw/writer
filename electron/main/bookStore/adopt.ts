// AI 提案采纳引擎（M4b T3）——提案条目写进正式书数据的唯一合法入口。
// 主进程代码：相对导入 + node: 前缀。正式实体一律经 M2 repository 落盘（守卫/校验/引用检查/
// 缓存/原子写全复用）；`.ai/` 派生数据（summary/index）由本引擎直写（docStore 原子写咽喉）。
//
// 控制器裁定实现图：
// - R1 origin 机制：`aiTouched?: string[]`（CharacterV2/WorldEntryV2，schema.ts 已扩）。
//   人写 = 存量字段非空（string trim 非空 / 数组非空 / number≠0 / boolean true）且名字不在 aiTouched。
//   update 命中人写字段且无 overwritesHuman:true → 整条拒 `REFUSED: 覆盖人写内容 <field>`；
//   overwritesHuman:true 还需通道参数 confirmedOverwrite 含该索引（UI 已确认），否则 `REFUSED: 未确认覆盖`。
//   应用成功 = 显式逐键拷贝 + aiTouched 追加所应用键 + updatedAt 刷新（repository 侧）。
//   create×character/world 播种 aiTouched = 所写非空字段名清单（裁定 A：AI 产字段不得伪装人写——
//   否则后续整理改自己建的卡也要旗标+确认，摩擦裁定④的收口）。
// - R2 __proto__ 加固：提案载荷绝不 Object.assign / spread-合并进存量对象。应用一律走
//   FIELD_ALLOWLIST（schema.ts 声明字段）+ own-property 双门；'__proto__' 与保留键
//   （id/createdAt/updatedAt/aiTouched/status）显式跳过——'__proto__' 键的赋值会触发 setter，
//   连 merged[key] 形式都禁止，只能 continue。
//   update 侧未知字段（既不在 allowlist 也不在保留回显集）→ 整条拒 `REFUSED: 未知字段 <key>`
//   （评审 I2 裁定：静默丢弃会让 appliedIndexes 说谎——提案要求了 X、什么都没应用、却显示已采纳；
//   保留键回显照旧静默丢弃——信封回显是 T2 规约容忍的正常噪音）。
// - R3 采纳期深校验：create×character/world/plotline/choice → after 过对应 schema 校验器
//   （注入新鲜 randomUUID + now ISO 后全形状校验）；create×foreshadow → after 即 ForeshadowEntry
//   （validateForeshadowEntry；id 一律注入新 UUID——防 AI 伪造/幻觉 id 撞上既有条目被 upsert 归并，
//   这是对本引擎的从严偏差，见 T3 报告）；update×foreshadow → 仅 status/plannedPayoffNote/note，
//   任何写盘前先对「存量+拟改字段」候选整体跑 validateForeshadowEntry（评审 I1：半应用即撒谎——
//   转移已落账而 note 类型坏被拒，条目状态与提案账目分叉；预校验保证单条全有或全无），
//   通过后状态转移路由 narrative.ts 状态机（resolved 的回收章 = 整理章 proposal.chapterId）；
//   update×summary → after.text 非空，targetId（create 缺省 = 整理章）必须是存在章，
//   落 `.ai/summaries/chapters/<id>.yaml` {chapterId,text,updatedAt,aiModel}；
//   update×index → after.adds[{entityId,chapterId}] 双 UUID 形状 + entityId ∈ 角色∪词条∪伏笔 +
//   chapterId ∈ 现存章（章存在性是本引擎在裁定之上的从严——幻影章进索引即垃圾，宁拒），
//   合并进 `.ai/index.json`（Record<entityId, chapterId[]>，去重，按 listChapters 章序存储）；
//   update×index 的 targetId 为占位（校验器要求 update 必携，值不参与语义——index 是全书单一总目录）；
//   delete×plotline/choice/foreshadow → targetId 存在性必须（缺失 → 拒），路由 narrative.ts 删除口
//   （伏笔无独立删除函数——readLedger+writeLedger 即台账的正典读写咽喉，writeLedger 自带校验闸门）。
//
// 批次纪律：逐条 try/catch——一条坏不拖累整批；拒绝原因一律 `REFUSED: ` 前缀 + 中文/仓库错误码
// （PROPOSAL_* 通道级错误除外：提案缺失/坏 id 直接抛穿）。批内有采纳 → markSettled 记账
// （appliedIndexes 并集 + status 重算）；全拒 → 提案文件零字节改动。重复索引只处理一次；
// 已采纳索引再报 → `REFUSED: 条目已采纳`（防双写：create 重复会造出双胞胎实体）。
// 双保险：每条在采纳现场重跑 validateChange（ALLOWED_OPS 复查）——手改文件绕过 writeProposal
// 前置校验时，delete×character 之流仍在这里被逐条拒。
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { CharacterGender, CharacterRole, SettingCategory } from '../../../src/common/ipc'
import type {
  CharacterV2,
  ChoiceNodeV2,
  ForeshadowEntry,
  PlotlineV2,
  WorldEntryV2
} from '../../../src/common/schema'
import {
  UUID_PATTERN,
  validateCharacterV2,
  validateChoiceNodeV2,
  validateForeshadowEntry,
  validatePlotlineV2,
  validateWorldEntryV2
} from '../../../src/common/schema'
import type {
  ProposalAdoptRefusal,
  ProposalAdoptResult,
  ProposalChange,
  ProposalEntity
} from '../../../src/common/proposal'
import { validateChange } from '../../../src/common/proposal'
import type { RawProposal } from './proposals'
import {
  computeProposalStatus,
  deleteProposal,
  loadProposalRaw,
  markSettled,
  sanitizeAppliedIndexes,
  saveProposalRaw
} from './proposals'
import { createCharacter, getCharacter, updateCharacter } from './characters'
import { createWorldEntry, getWorldEntry, updateWorldEntry } from './world'
import { listChapters } from './chapters'
import {
  abandonForeshadow,
  createChoice,
  createPlotline,
  deleteChoice,
  deletePlotline,
  listChoices,
  listPlotlines,
  readLedger,
  reopenForeshadow,
  resolveForeshadow,
  updateChoice,
  updatePlotline,
  upsertForeshadow,
  writeLedger
} from './narrative'
import { characterIds, worldIds } from './refs'
import { aiIndexFile, chapterSummaryFile } from './paths'
import { writeTextFileAtomic, writeYamlFileAtomic } from './docStore'

// ---------------------------------------------------------------------------
// 字段白名单（R2 单一权威：逐实体对照 schema.ts 声明形状；保留键绝不入表）
// ---------------------------------------------------------------------------

/** 各实体可经提案写入的字段（schema.ts 声明形状减去系统专属键；改动需过评审）。 */
export const FIELD_ALLOWLIST: Record<ProposalEntity, string[]> = {
  character: [
    'name', 'gender', 'age', 'role', 'avatar', 'appearance', 'personality',
    'background', 'goals', 'flaws', 'relationships', 'arc', 'tags', 'notes', 'links'
  ],
  world: ['title', 'category', 'content', 'parentId', 'order', 'tags', 'links'],
  plotline: ['title', 'summary', 'status', 'stages'], // status 仅 create 可用（update 侧保留键跳过）
  choice: ['title', 'chapterId', 'options'],
  foreshadow: ['title', 'plantedChapterId', 'plannedPayoffNote', 'resolvedChapterId', 'status', 'note'],
  summary: ['text'],
  index: ['adds']
}

/** update×foreshadow 的窄门（裁定 R3）：机对 status 走状态机 + 两个说明字段；其余键忽略。 */
const FORESHADOW_UPDATE_FIELDS = ['status', 'plannedPayoffNote', 'note']

/** update 路径的保留键：仓库/系统专属（plotline.status 是生命周期字段，AI 不得改写）。 */
const RESERVED_UPDATE = new Set(['id', 'createdAt', 'updatedAt', 'aiTouched', 'status'])

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireAfterRecord(change: ProposalChange): Record<string, unknown> {
  if (!isPlainRecord(change.after)) throw new Error('after 必须是对象')
  return change.after
}

/**
 * R1「非空 = 有内容」判定：string trim 非空 / 数组非空 / number 有限且 ≠0（0 = 仓库默认空值，
 * 如 age/order 的 create 缺省）/ boolean true；null/undefined = 空；未知对象形状一律视为有内容
 * （宁拒不放——从严口径，见 T3 报告）。
 */
function isHumanContent(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0
  if (typeof v === 'boolean') return v === true
  return true
}

/** 存量 aiTouched 的消毒读取（手改垃圾 → 视为无记录；只留字符串元素）。 */
function touchedFields(doc: Record<string, unknown>): string[] {
  const t = doc.aiTouched
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : []
}

/** R1 通道门：overwritesHuman:true 的条目必须出现在 confirmedOverwrite（UI 已确认）。 */
function assertOverwriteConfirmed(change: ProposalChange, index: number, confirmed: Set<number>): void {
  if (change.overwritesHuman === true && !confirmed.has(index)) {
    throw new Error('未确认覆盖')
  }
}

// ---------------------------------------------------------------------------
// update 合并（R1 origin 守卫版 / 无守卫版；R2 显式逐键拷贝）
// ---------------------------------------------------------------------------

/**
 * character/world 专用（带 aiTouched 的实体）：origin 守卫 + 显式逐键拷贝 + aiTouched 记账。
 * 基座 `{...stored}` 是存量（仓库数据）的浅拷贝——载荷（after）绝不参与 spread，
 * 只经 allowlist 过滤后逐键赋值（R1「EXPLICIT per-key copy」/ R2「spread-into-existing 禁令」）。
 */
function mergeGuarded(
  stored: Record<string, unknown>,
  after: Record<string, unknown>,
  allowlist: string[],
  change: ProposalChange
): Record<string, unknown> {
  const touched = new Set(touchedFields(stored))
  const merged: Record<string, unknown> = { ...stored }
  const appliedKeys: string[] = []
  for (const key of Object.keys(after)) {
    if (key === '__proto__') continue // R2：显式跳过（安全跳过，不按未知字段拒——对该键赋值会触发原型 setter）
    if (RESERVED_UPDATE.has(key)) continue // 保留键回显：静默丢弃（信封回显是正常噪音，仓库侧另行维护）
    if (!allowlist.includes(key)) throw new Error(`未知字段 ${key}`) // 评审 I2：静默丢弃会让 appliedIndexes 说谎——整条拒（首个肇事键入 reason）
    if (change.overwritesHuman !== true && !touched.has(key) && isHumanContent(stored[key])) {
      throw new Error(`覆盖人写内容 ${key}`) // R1：人写内容必须显式旗标 + 通道确认
    }
    merged[key] = after[key]
    appliedKeys.push(key)
  }
  if (appliedKeys.length === 0) throw new Error('无可应用字段')
  // R1 记账：本次应用的键并入 aiTouched（去重、保持存量序在前）
  merged.aiTouched = [...new Set([...touched, ...appliedKeys])]
  return merged
}

/** plotline/choice 专用：无 aiTouched 语义（类型上没有该字段）；未知字段拒绝纪律同 mergeGuarded（I2）。 */
function mergePlain(
  stored: Record<string, unknown>,
  after: Record<string, unknown>,
  allowlist: string[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored }
  let count = 0
  for (const key of Object.keys(after)) {
    if (key === '__proto__') continue // R2 安全跳过
    if (RESERVED_UPDATE.has(key)) continue // 保留键回显：静默丢弃
    if (!allowlist.includes(key)) throw new Error(`未知字段 ${key}`) // 评审 I2
    merged[key] = after[key]
    count += 1
  }
  if (count === 0) throw new Error('无可应用字段')
  return merged
}

// ---------------------------------------------------------------------------
// create（R3：注入新 id/时间戳后全形状深校验，再过 repository 二次校验 + 原子写）
// ---------------------------------------------------------------------------

/** allowlist + own-property 双门拷贝（R2：'__proto__'/未知键/继承属性天然进不来）。 */
function buildCandidate(after: Record<string, unknown>, allowlist: string[]): Record<string, unknown> {
  const candidate: Record<string, unknown> = {}
  const now = new Date().toISOString()
  candidate.id = randomUUID() // R3：新鲜 UUID（AI 不产 id——T2 规约同款立场）
  candidate.createdAt = now
  candidate.updatedAt = now
  for (const key of allowlist) {
    if (hasOwn(after, key)) candidate[key] = after[key]
  }
  return candidate
}

/**
 * 裁定 A（create 播种 aiTouched）：after 实际写入且值非空的 allowlist 字段名（按 allowlist 序）。
 * 空值字段（''/[]/0/null）不入账——空即无内容，人后续填写天然是人写（R1 判定不受影响）。
 */
function writtenNonEmptyKeys(after: Record<string, unknown>, allowlist: string[]): string[] {
  const keys: string[] = []
  for (const key of allowlist) {
    if (hasOwn(after, key) && isHumanContent(after[key])) keys.push(key)
  }
  return keys
}

function adoptCreateCharacter(p: string, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  const candidate = buildCandidate(after, FIELD_ALLOWLIST.character)
  // 裁定 A：AI 产字段入册即记名——后续整理改自己建的卡不再被误判「覆盖人写内容」
  const touched = writtenNonEmptyKeys(after, FIELD_ALLOWLIST.character)
  if (touched.length > 0) candidate.aiTouched = touched // 校验器对 aiTouched 宽容（schema.ts 注释）
  const errors = validateCharacterV2(candidate)
  if (errors.length > 0) throw new Error(`角色形状非法: ${errors.join('; ')}`)
  createCharacter(
    p,
    {
      name: candidate.name as string,
      gender: candidate.gender as CharacterGender,
      role: candidate.role as CharacterRole
    },
    candidate as Partial<CharacterV2>
  ) // 仓库侧再跑 validate + REF_BROKEN 引用检查 + 原子写（双保险；id/时间戳以仓库注入为准）
}

function adoptCreateWorld(p: string, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  const candidate = buildCandidate(after, FIELD_ALLOWLIST.world)
  const touched = writtenNonEmptyKeys(after, FIELD_ALLOWLIST.world) // 裁定 A（同 create×character）
  if (touched.length > 0) candidate.aiTouched = touched
  const errors = validateWorldEntryV2(candidate)
  if (errors.length > 0) throw new Error(`词条形状非法: ${errors.join('; ')}`)
  createWorldEntry(
    p,
    {
      title: candidate.title as string,
      category: candidate.category as SettingCategory,
      content: candidate.content as string
    },
    candidate as Partial<WorldEntryV2>
  )
}

function adoptCreatePlotline(p: string, change: ProposalChange): void {
  const candidate = buildCandidate(requireAfterRecord(change), FIELD_ALLOWLIST.plotline)
  const errors = validatePlotlineV2(candidate)
  if (errors.length > 0) throw new Error(`剧情线形状非法: ${errors.join('; ')}`)
  createPlotline(
    p,
    {
      title: candidate.title as string,
      summary: candidate.summary as string,
      status: candidate.status as PlotlineV2['status']
    },
    candidate as Partial<PlotlineV2>
  )
}

function adoptCreateChoice(p: string, change: ProposalChange): void {
  const candidate = buildCandidate(requireAfterRecord(change), FIELD_ALLOWLIST.choice)
  const errors = validateChoiceNodeV2(candidate)
  if (errors.length > 0) throw new Error(`选项形状非法: ${errors.join('; ')}`)
  createChoice(
    p,
    { title: candidate.title as string, chapterId: candidate.chapterId as string },
    candidate as Partial<ChoiceNodeV2>
  ) // chapterId 幻影由仓库引用检查拒（REF_BROKEN）
}

function adoptCreateForeshadow(p: string, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  // 裁定偏差（从严）：id 一律注入新鲜 UUID、after.id 忽略——伪造/幻觉 id 撞上既有条目时
  // upsert 会走「归并覆盖载荷」分支，等于静默改写存量伏笔；新鲜 id 保证本操作永远是追加。
  const candidate: Record<string, unknown> = { id: randomUUID() }
  for (const key of FIELD_ALLOWLIST.foreshadow) {
    if (hasOwn(after, key)) candidate[key] = after[key]
  }
  const errors = validateForeshadowEntry(candidate)
  if (errors.length > 0) throw new Error(`伏笔形状非法: ${errors.join('; ')}`)
  upsertForeshadow(p, candidate as unknown as ForeshadowEntry) // absent id → 追加语义（writeLedger 校验闸门在后）
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

function adoptUpdateCharacter(p: string, index: number, change: ProposalChange, confirmed: Set<number>): void {
  assertOverwriteConfirmed(change, index, confirmed) // 先查确认（宁拒不猜——旗标过期/未勾一律拦）
  const after = requireAfterRecord(change)
  const stored = getCharacter(p, change.targetId as string) // 非 UUID → BAD_CHARACTER_ID 抛穿（逐条拒）
  if (!stored) throw new Error(`CHARACTER_MISSING: ${change.targetId}`)
  const merged = mergeGuarded(stored as unknown as Record<string, unknown>, after, FIELD_ALLOWLIST.character, change)
  updateCharacter(p, merged as unknown as CharacterV2) // 仓库侧整卡校验 + 引用检查 + updatedAt 刷新（R1）
}

function adoptUpdateWorld(p: string, index: number, change: ProposalChange, confirmed: Set<number>): void {
  assertOverwriteConfirmed(change, index, confirmed)
  const after = requireAfterRecord(change)
  const stored = getWorldEntry(p, change.targetId as string)
  if (!stored) throw new Error(`WORLD_MISSING: ${change.targetId}`)
  const merged = mergeGuarded(stored as unknown as Record<string, unknown>, after, FIELD_ALLOWLIST.world, change)
  updateWorldEntry(p, merged as unknown as WorldEntryV2)
}

function adoptUpdatePlotline(p: string, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  // narrative.ts 无点读函数——list 侧查缺（坏档已被 list warn+跳过，按 MISSING 拒，见 T3 报告）
  const stored = listPlotlines(p).find((x) => x.id === change.targetId)
  if (!stored) throw new Error(`PLOTLINE_MISSING: ${change.targetId}`)
  const merged = mergePlain(stored as unknown as Record<string, unknown>, after, FIELD_ALLOWLIST.plotline)
  updatePlotline(p, merged as unknown as PlotlineV2) // 仓库侧校验 + stages 引用检查 + updatedAt 刷新
}

function adoptUpdateChoice(p: string, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  const stored = listChoices(p).find((x) => x.id === change.targetId)
  if (!stored) throw new Error(`CHOICE_MISSING: ${change.targetId}`)
  const merged = mergePlain(stored as unknown as Record<string, unknown>, after, FIELD_ALLOWLIST.choice)
  updateChoice(p, merged as unknown as ChoiceNodeV2) // chapterId 改到幻影由仓库拒（REF_BROKEN）
}

function adoptUpdateForeshadow(p: string, proposal: RawProposal, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  const id = change.targetId as string
  const entry = readLedger(p).entries.find((e) => e.id === id) // 坏台账抛穿 → 逐条拒（绝不整写覆盖）
  if (!entry) throw new Error(`FORESHADOW_MISSING: ${id}`)
  const hasStatus = hasOwn(after, 'status')
  const hasPayoff = hasOwn(after, 'plannedPayoffNote')
  const hasNote = hasOwn(after, 'note')
  if (!hasStatus && !hasPayoff && !hasNote) {
    throw new Error(`无可应用字段（伏笔 update 仅允许 ${FORESHADOW_UPDATE_FIELDS.join('/')}）`)
  }
  // 评审 I1（单条全有或全无）：任何写盘前，先对「存量 + 拟改字段」候选整体深校验——
  // 曾经 status 转移先落账、坏类型 note 才被 upsert 拦下，条目半应用而提案账目记拒（撒谎）。
  // 候选校验把类型/枚举错误全部前置到零写盘时点；转移合法性（FORESHADOW_TRANSITION）本身
  // 由状态机在写前自拒，同样零写盘——两段合起来保证本条要么全落、要么磁盘字节不动。
  const candidate: ForeshadowEntry = { ...entry } // 存量拷贝；拟改字段仅在下方显式逐键赋值（R2）
  if (hasStatus) candidate.status = after.status as ForeshadowEntry['status']
  if (hasPayoff) candidate.plannedPayoffNote = after.plannedPayoffNote as string
  if (hasNote) candidate.note = after.note as string | undefined
  const errors = validateForeshadowEntry(candidate)
  if (errors.length > 0) throw new Error(`伏笔形状非法: ${errors.join('; ')}`)
  if (hasStatus && candidate.status !== entry.status) {
    // 机对转移一律路由 narrative.ts 状态机（非法转移 FORESHADOW_TRANSITION 逐条拒，写前自拒零落盘）；
    // resolved 的回收章 = 整理章（after 无 resolvedChapterId——R3 窄门刻意不放行）
    if (candidate.status === 'resolved') resolveForeshadow(p, id, proposal.chapterId)
    else if (candidate.status === 'abandoned') abandonForeshadow(p, id)
    else reopenForeshadow(p, id) // 'open'（枚举已候选校验，剩余唯一转移值）
  }
  if (hasPayoff || hasNote) {
    const fresh = readLedger(p).entries.find((e) => e.id === id) // 转移后以最新存量为基
    if (!fresh) throw new Error(`FORESHADOW_MISSING: ${id}`)
    const merged: ForeshadowEntry = { ...fresh } // 存量拷贝；载荷仅在下方显式逐键赋值（R2）
    if (hasPayoff) merged.plannedPayoffNote = after.plannedPayoffNote as string
    if (hasNote) merged.note = after.note as string | undefined
    upsertForeshadow(p, merged) // existing id：status/resolvedChapterId 以存量为准（机对安全），写前校验
  }
}

// ---------------------------------------------------------------------------
// summary / index（.ai/ 派生数据，引擎直写；无 origin 语义——AI 领地）
// ---------------------------------------------------------------------------

function adoptSummary(p: string, proposal: RawProposal, change: ProposalChange): void {
  const after = requireAfterRecord(change)
  // update 的 targetId 已由 validateChange 保证非空；create 缺省 = 整理章（proposal.chapterId）
  const target =
    typeof change.targetId === 'string' && change.targetId.trim() !== ''
      ? change.targetId
      : proposal.chapterId
  // 章存在性硬门：target 必须是现存章 id（垃圾/幻影/非 UUID 一律死在这一关 → 路径拼接安全）
  if (!listChapters(p).some((c) => c.id === target)) {
    throw new Error(`CHAPTER_MISSING: ${target}`)
  }
  const text = hasOwn(after, 'text') ? after.text : undefined
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('after.text 必须是非空字符串')
  }
  writeYamlFileAtomic(chapterSummaryFile(p, target), {
    chapterId: target,
    text,
    updatedAt: new Date().toISOString(),
    aiModel: proposal.aiModel
  })
}

function adoptIndex(p: string, change: ProposalChange): void {
  // targetId：validateChange 对 update 一律要求非空（T1 把 index 的指向语义留给 T3）——
  // 裁定：index 是全书单一派生总目录，targetId 无语义（占位=整理章），引擎忽略其值。
  const after = requireAfterRecord(change)
  const adds = hasOwn(after, 'adds') ? after.adds : undefined
  if (!Array.isArray(adds) || adds.length === 0) {
    throw new Error('after.adds 必须是非空数组')
  }
  const chapters = listChapters(p) // meta.order 升序 = 章序权威
  const chapterRank = new Map<string, number>()
  chapters.forEach((c, i) => chapterRank.set(c.id, i))
  // entityId 合法目标集 = 角色 ∪ 词条 ∪ 伏笔（裁定 R3；refs 直扫 = 磁盘真相，永不走缓存）
  const knownEntities = new Set<string>([
    ...characterIds(p),
    ...worldIds(p),
    ...readLedger(p).entries.map((e) => e.id)
  ])
  const pairs: Array<[string, string]> = []
  for (const add of adds) {
    if (!isPlainRecord(add)) throw new Error('index.adds 条目必须是对象')
    const entityId = add.entityId
    const chapterId = add.chapterId
    if (
      typeof entityId !== 'string' || !UUID_PATTERN.test(entityId) ||
      typeof chapterId !== 'string' || !UUID_PATTERN.test(chapterId)
    ) {
      throw new Error(`index.adds id 形状非法: entityId=${String(entityId)} chapterId=${String(chapterId)}`)
    }
    if (!knownEntities.has(entityId)) throw new Error(`REF_BROKEN: ${entityId}`)
    // 章存在性 = 本引擎在裁定之上的从严（裁定只要求 UUID 形状）：幻影章进索引即垃圾，宁拒
    if (!chapterRank.has(chapterId)) throw new Error(`REF_BROKEN: ${chapterId}`)
    pairs.push([entityId, chapterId])
  }

  // 既有索引装载：真 JSON（JSON.parse 对 '__proto__' 产 own property，不触发 setter——解析安全）；
  // 派生数据可再生：坏文件 warn + 按空索引重建（绝不因缓存损坏卡死整理闭环），坏值键跳过。
  const abs = aiIndexFile(p)
  const merged = new Map<string, string[]>()
  if (existsSync(abs)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(abs, 'utf8'))
      if (isPlainRecord(parsed)) {
        for (const key of Object.keys(parsed)) {
          if (key === '__proto__') continue // R2：污染过的键直接丢弃
          const v = parsed[key]
          if (Array.isArray(v) && v.every((x) => typeof x === 'string')) merged.set(key, [...v])
          else console.warn(`跳过 .ai/index.json 非法值（键将重建）: ${abs}: ${key}`)
        }
      } else {
        console.warn(`.ai/index.json 顶层非对象，按空索引重建: ${abs}`)
      }
    } catch (err) {
      console.warn(
        `.ai/index.json 损坏，按空索引重建: ${abs}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  for (const [entityId, chapterId] of pairs) {
    const list = merged.get(entityId) ?? []
    if (!list.includes(chapterId)) list.push(chapterId) // 去重
    merged.set(entityId, list)
  }
  // 章序存储：按 listChapters 位次；历史残留的未知章（章后来被删）排尾部按 id 稳定（确定性）
  const out: Record<string, string[]> = {}
  for (const [entityId, list] of merged) {
    if (entityId === '__proto__') continue // 双保险（上方装载已滤，add 侧 UUID 门天然排除）
    list.sort(
      (a, b) =>
        (chapterRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (chapterRank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b)
    )
    out[entityId] = list // entityId 已过 UUID/非 __proto__ 门——普通键赋值安全
  }
  writeTextFileAtomic(abs, JSON.stringify(out, null, 2) + '\n') // .json 后缀 = 真 JSON 字节（第三方 JSON.parse 可读）
}

// ---------------------------------------------------------------------------
// delete（存在性必须——裁定 R3；幂等 false 一律转拒）
// ---------------------------------------------------------------------------

function adoptDelete(p: string, change: ProposalChange): void {
  const id = change.targetId as string
  switch (change.entity) {
    case 'plotline':
      if (!deletePlotline(p, id)) throw new Error(`PLOTLINE_MISSING: ${id}`)
      return
    case 'choice':
      if (!deleteChoice(p, id)) throw new Error(`CHOICE_MISSING: ${id}`)
      return
    case 'foreshadow': {
      const ledger = readLedger(p)
      if (!ledger.entries.some((e) => e.id === id)) throw new Error(`FORESHADOW_MISSING: ${id}`)
      // narrative.ts 无伏笔删除函数——readLedger/writeLedger 即台账正典读写咽喉（校验闸门在 writeLedger）
      writeLedger(p, { entries: ledger.entries.filter((e) => e.id !== id) })
      return
    }
    default:
      // delete×character/world/summary/index 已被 validateChange（ALLOWED_OPS）双保险拦下——兜底
      throw new Error(`不支持的删除目标: ${change.entity}`)
  }
}

// ---------------------------------------------------------------------------
// 逐条分派 + 批次入口
// ---------------------------------------------------------------------------

/** 单条应用（抛 Error = 拒绝，reason 由批次入口包 `REFUSED: ` 前缀）。 */
function applyChange(
  p: string,
  proposal: RawProposal,
  index: number,
  change: ProposalChange,
  confirmed: Set<number>
): void {
  const entity = change.entity
  if (change.op === 'create') {
    switch (entity) {
      case 'character': return adoptCreateCharacter(p, change)
      case 'world': return adoptCreateWorld(p, change)
      case 'plotline': return adoptCreatePlotline(p, change)
      case 'choice': return adoptCreateChoice(p, change)
      case 'foreshadow': return adoptCreateForeshadow(p, change)
      case 'summary': return adoptSummary(p, proposal, change)
      default: throw new Error(`不支持的 op×entity: create×${entity}`) // create×index 已被 validateChange 拦
    }
  }
  if (change.op === 'update') {
    switch (entity) {
      case 'character': return adoptUpdateCharacter(p, index, change, confirmed)
      case 'world': return adoptUpdateWorld(p, index, change, confirmed)
      case 'plotline': return adoptUpdatePlotline(p, change)
      case 'choice': return adoptUpdateChoice(p, change)
      case 'foreshadow': return adoptUpdateForeshadow(p, proposal, change)
      case 'summary': return adoptSummary(p, proposal, change)
      case 'index': return adoptIndex(p, change)
    }
  }
  return adoptDelete(p, change) // delete：组合表已在 validateChange 限定 plotline/choice/foreshadow
}

/**
 * 采纳批次（proposal:adopt 通道的引擎本体）：
 * 逐条「重读现状 → 双保险 validateChange → origin 守卫（R1）→ allowlist 应用（R2/R3）→ repository 落盘」，
 * 单条失败按条拒（`REFUSED: ` 前缀 reason），批内有成功 → markSettled 记账（失败抛穿——
 * 静默丢 applied 追踪会导致重采纳双写，必须响亮）。提案缺失/坏 id → PROPOSAL_MISSING/BAD_PROPOSAL_ID
 * 抛穿（通道级错误，非逐条拒）。
 */
export function adoptChanges(
  p: string,
  proposalId: string,
  changeIndexes: number[],
  confirmedOverwrite: number[]
): ProposalAdoptResult {
  if (!Array.isArray(changeIndexes)) {
    throw new Error('PROPOSAL_BAD_PARAMS: changeIndexes 必须是数组')
  }
  const confirmed = new Set(
    Array.isArray(confirmedOverwrite) ? confirmedOverwrite.filter((x) => Number.isInteger(x)) : []
  )
  const { proposal } = loadProposalRaw(p, proposalId) // 宽容装载：坏条目留给逐条双保险
  const appliedSet = new Set(proposal.appliedIndexes)
  const applied: number[] = []
  const refused: ProposalAdoptRefusal[] = []
  const seen = new Set<number>()
  for (const index of changeIndexes) {
    if (!Number.isInteger(index)) {
      refused.push({ index, reason: `REFUSED: 条目索引非法: ${String(index)}` })
      continue
    }
    if (index < 0 || index >= proposal.changes.length) {
      refused.push({ index, reason: 'REFUSED: 条目索引越界' })
      continue
    }
    if (seen.has(index)) continue // 重复上报只处理一次（不算拒绝——同一意图的幂等收敛）
    seen.add(index)
    if (appliedSet.has(index)) {
      refused.push({ index, reason: 'REFUSED: 条目已采纳' }) // 防双写：create 重复会造双胞胎实体
      continue
    }
    const raw = proposal.changes[index]
    const errors = validateChange(raw) // 双保险：ALLOWED_OPS/必备字段在采纳现场复查（手改文件也逃不掉）
    if (errors.length > 0) {
      refused.push({ index, reason: `REFUSED: ${errors.join('; ')}` })
      continue
    }
    try {
      applyChange(p, proposal, index, raw as ProposalChange, confirmed)
      applied.push(index)
      appliedSet.add(index)
    } catch (err) {
      // 逐条 try/catch：repository 守卫（REF_BROKEN/*_INVALID/*_MISSING）与本引擎的 origin/形状拒绝
      // 同槽收敛——一条坏不拖累整批
      refused.push({ index, reason: `REFUSED: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  if (applied.length > 0) markSettled(p, proposalId, applied) // 全拒批次零写盘（提案文件字节不动）
  return { applied, refused }
}

/**
 * 驳回批次（proposal:reject 通道的引擎本体）：删除指定条目并重写提案；
 * 全部删空 → 整份提案删除（deleteProposal）。appliedIndexes 随删除重排（被删条目的 applied
 * 记账出账；存活条目索引前移）；status 由剩余条目重算。空/越界索引幂等忽略（零写盘）。
 */
export function rejectChanges(p: string, proposalId: string, changeIndexes: number[]): void {
  if (!Array.isArray(changeIndexes)) {
    throw new Error('PROPOSAL_BAD_PARAMS: changeIndexes 必须是数组')
  }
  const { proposal } = loadProposalRaw(p, proposalId)
  const remove = new Set<number>()
  for (const i of changeIndexes) {
    if (Number.isInteger(i) && i >= 0 && i < proposal.changes.length) remove.add(i)
  }
  if (remove.size === 0) return // 无可删 → 零写盘（幂等）
  const kept = proposal.changes.filter((_, i) => !remove.has(i))
  if (kept.length === 0) {
    deleteProposal(p, proposalId)
    return
  }
  // 旧索引 → 新索引重排表；已采纳但被驳回的条目出账
  const remap = new Map<number, number>()
  proposal.changes.forEach((_, i) => {
    if (!remove.has(i)) remap.set(i, remap.size)
  })
  const applied = sanitizeAppliedIndexes(
    proposal.appliedIndexes
      .map((i) => remap.get(i))
      .filter((x): x is number => x !== undefined),
    kept.length
  )
  saveProposalRaw(p, {
    id: proposal.id,
    chapterId: proposal.chapterId,
    createdAt: proposal.createdAt,
    aiModel: proposal.aiModel,
    status: computeProposalStatus(kept.length, applied.length),
    changes: kept,
    appliedIndexes: applied
  })
}
