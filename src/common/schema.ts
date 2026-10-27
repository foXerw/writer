// v2 数据模型类型 + 手写校验守卫（主/渲染进程共用，零运行时依赖）。
// 校验口径：必备字段存在 + 类型正确 + 枚举值在集合内 + 实体 `id` 匹配 UUID；
// 不校验引用完整性（targetId/chapterId 指向是否存在属于 repository 层，Task 3/6）。
// 未知多余字段一律容忍（向前兼容）。

import type {
  ProjectType,
  ProjectConfig,
  SettingCategory,
  CharacterGender,
  CharacterRole,
  CharacterTag
} from './ipc'

// ---------------------------------------------------------------------------
// 常量与枚举集合（运行时校验用；类型本体来自 ipc.ts）
// ---------------------------------------------------------------------------

export const FORMAT_VERSION = 2

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PROJECT_TYPES: readonly ProjectType[] = ['novel', 'script', 'essay']
export const CHAPTER_STATUSES: readonly string[] = ['draft', 'revising', 'completed']
export const CHARACTER_GENDERS: readonly CharacterGender[] = ['male', 'female', 'other']
export const CHARACTER_ROLES: readonly CharacterRole[] = [
  'protagonist',
  'antagonist',
  'supporting',
  'minor'
]
export const SETTING_CATEGORIES: readonly SettingCategory[] = [
  'location',
  'history',
  'magic',
  'culture',
  'other'
]
export const PLOTLINE_STATUSES: readonly string[] = ['active', 'done', 'dormant']
export const FORESHADOW_STATUSES: readonly string[] = ['open', 'resolved', 'abandoned']

// ---------------------------------------------------------------------------
// v2 类型定义
// ---------------------------------------------------------------------------

export interface BookMeta {
  id: string
  name: string
  type: ProjectType
  formatVersion: 2
  config: ProjectConfig
  synopsis: string
}

export interface VolumeDoc {
  id: string
  title: string
  order: number
}

export interface ChapterMeta {
  id: string
  title: string
  volumeId: string | null
  order: number
  status: 'draft' | 'revising' | 'completed'
}

// 章节 = 元信息 + 正文（解析/序列化在 Task 4 的 chapterDoc.ts，此处只定类型）
export interface ChapterDoc {
  meta: ChapterMeta
  body: string
}

// 关系边 / 设定链接的通用结构（角色关系、词条互链、伏笔挂章节等）
export interface EntityLink {
  targetId: string
  kind: string
  note?: string
}

export interface CharacterArcStage {
  title: string
  summary: string
  chapterIds: string[]
}

export interface CharacterV2 {
  id: string
  name: string
  gender: CharacterGender
  age: number
  role: CharacterRole
  avatar?: string
  appearance: string
  personality: string
  background: string
  goals?: string
  flaws?: string
  relationships: EntityLink[]
  arc: CharacterArcStage[]
  tags: CharacterTag[]
  notes?: string
  links: EntityLink[]
  /**
   * M4b origin 机制（控制器裁定 R1）：AI 采纳引擎写过的字段名清单。
   * 语义：某已存字段是「人写」当且仅当它非空（string trim 后非空 / 数组非空）且名字不在 aiTouched。
   * 只由 adopt 引擎维护（应用字段时追加）；校验器刻意不检查本字段（宽容，向前兼容），
   * 人手编辑路径原样回显即可。缺失 = 从未有 AI 采纳写入（v2 存量数据常态）。
   */
  aiTouched?: string[]
  // 一律 ISO 字符串（new Date().toISOString()），根治 v1 Date 序列化漂移
  createdAt: string
  updatedAt: string
}

export interface WorldEntryV2 {
  id: string
  title: string
  category: SettingCategory
  content: string
  parentId: string | null
  order: number
  tags: string[]
  links: EntityLink[]
  /** M4b origin 机制（裁定 R1，语义同 CharacterV2.aiTouched）：AI 采纳引擎写过的字段名清单。 */
  aiTouched?: string[]
  createdAt: string
  updatedAt: string
}

export interface PlotlineStage {
  title: string
  summary: string
  chapterIds: string[]
  entityIds: string[]
}

export interface PlotlineV2 {
  id: string
  title: string
  summary: string
  status: 'active' | 'done' | 'dormant'
  stages: PlotlineStage[]
  createdAt: string
  updatedAt: string
}

export interface ChoiceOption {
  label: string
  consequence: string
}

export interface ChoiceNodeV2 {
  id: string
  title: string
  chapterId: string
  options: ChoiceOption[]
  createdAt: string
  updatedAt: string
}

export interface ForeshadowEntry {
  id: string
  title: string
  plantedChapterId: string
  plannedPayoffNote: string
  resolvedChapterId: string | null
  status: 'open' | 'resolved' | 'abandoned'
  note?: string
}

export interface ForeshadowLedger {
  entries: ForeshadowEntry[]
}

// ---------------------------------------------------------------------------
// 校验守卫工具（错误串一律带上字段路径，调用方按字段名做子串匹配）
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

function expectOptionalString(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  errors: Errors
): void {
  const value = obj[field]
  if (value === undefined) return
  if (typeof value !== 'string') errors.push(`${path}: expected string, got ${typeName(value)}`)
}

function expectStringOrNull(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  errors: Errors
): void {
  const value = obj[field]
  if (value !== null && typeof value !== 'string') {
    errors.push(`${path}: expected string or null, got ${typeName(value)}`)
  }
}

function expectNumber(obj: Record<string, unknown>, field: string, path: string, errors: Errors): void {
  if (typeof obj[field] !== 'number' || !Number.isFinite(obj[field] as number)) {
    errors.push(`${path}: expected finite number, got ${typeName(obj[field])}`)
  }
}

function expectBoolean(obj: Record<string, unknown>, field: string, path: string, errors: Errors): void {
  if (typeof obj[field] !== 'boolean') {
    errors.push(`${path}: expected boolean, got ${typeName(obj[field])}`)
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

function expectStringArray(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  errors: Errors
): void {
  const value = obj[field]
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) {
    errors.push(`${path}: expected array of strings, got ${typeName(value)}`)
  }
}

/** 取数组字段；非数组则记错并返回 null。 */
function getArray(obj: Record<string, unknown>, field: string, path: string, errors: Errors): unknown[] | null {
  const value = obj[field]
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array, got ${typeName(value)}`)
    return null
  }
  return value
}

/** 把子校验器的错误包一层父路径，使错误串同时含父字段名与子字段名。 */
function childErrors(label: string, index: number, inner: Errors): Errors {
  return inner.map((e) => `${label}[${index}]: ${e}`)
}

// ---------------------------------------------------------------------------
// 各类型校验器：返回 string[]，空数组 = 合法
// ---------------------------------------------------------------------------

export function validateEntityLink(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['entityLink: expected object, got ' + typeName(v)]
  expectString(v, 'targetId', 'entityLink.targetId', errors, true)
  expectString(v, 'kind', 'entityLink.kind', errors, true)
  expectOptionalString(v, 'note', 'entityLink.note', errors)
  return errors
}

/** EntityLink[] 字段通用校验（relationships / links）。 */
function validateLinkArray(obj: Record<string, unknown>, field: string, path: string, errors: Errors): void {
  const items = getArray(obj, field, path, errors)
  if (!items) return
  items.forEach((item, i) => errors.push(...childErrors(path, i, validateEntityLink(item))))
}

/** CharacterTag 沿用 v1 结构；其 id 历史上非 UUID，故只要求非空字符串（有意豁免 UUID）。 */
function validateCharacterTag(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['characterTag: expected object, got ' + typeName(v)]
  expectString(v, 'id', 'characterTag.id', errors, true)
  expectString(v, 'name', 'characterTag.name', errors, true)
  expectOptionalString(v, 'color', 'characterTag.color', errors)
  return errors
}

function validateArcStage(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['arcStage: expected object, got ' + typeName(v)]
  expectString(v, 'title', 'arcStage.title', errors, true)
  expectString(v, 'summary', 'arcStage.summary', errors)
  expectStringArray(v, 'chapterIds', 'arcStage.chapterIds', errors)
  return errors
}

export function validateBookMeta(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['bookMeta: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'bookMeta.id', errors)
  expectString(v, 'name', 'bookMeta.name', errors, true)
  expectEnum(v, 'type', 'bookMeta.type', PROJECT_TYPES, errors)
  if (v.formatVersion !== FORMAT_VERSION) {
    errors.push(`bookMeta.formatVersion: expected ${FORMAT_VERSION}, got ${typeName(v.formatVersion)}`)
  }
  const config = v.config
  if (!isRecord(config)) {
    errors.push(`bookMeta.config: expected object, got ${typeName(config)}`)
  } else {
    expectNumber(config, 'wordCountGoal', 'bookMeta.config.wordCountGoal', errors)
    expectNumber(config, 'dailyGoal', 'bookMeta.config.dailyGoal', errors)
    expectBoolean(config, 'autoSave', 'bookMeta.config.autoSave', errors)
    expectNumber(config, 'autoSaveInterval', 'bookMeta.config.autoSaveInterval', errors)
  }
  expectString(v, 'synopsis', 'bookMeta.synopsis', errors)
  return errors
}

export function validateVolumeDoc(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['volume: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'volume.id', errors)
  expectString(v, 'title', 'volume.title', errors, true)
  expectNumber(v, 'order', 'volume.order', errors)
  return errors
}

export function validateChapterMeta(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['chapterMeta: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'chapterMeta.id', errors)
  expectString(v, 'title', 'chapterMeta.title', errors, true)
  expectStringOrNull(v, 'volumeId', 'chapterMeta.volumeId', errors)
  expectNumber(v, 'order', 'chapterMeta.order', errors)
  expectEnum(v, 'status', 'chapterMeta.status', CHAPTER_STATUSES, errors)
  return errors
}

export function validateCharacterV2(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['character: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'character.id', errors)
  expectString(v, 'name', 'character.name', errors, true)
  expectEnum(v, 'gender', 'character.gender', CHARACTER_GENDERS, errors)
  expectNumber(v, 'age', 'character.age', errors)
  expectEnum(v, 'role', 'character.role', CHARACTER_ROLES, errors)
  expectOptionalString(v, 'avatar', 'character.avatar', errors)
  expectString(v, 'appearance', 'character.appearance', errors)
  expectString(v, 'personality', 'character.personality', errors)
  expectString(v, 'background', 'character.background', errors)
  expectOptionalString(v, 'goals', 'character.goals', errors)
  expectOptionalString(v, 'flaws', 'character.flaws', errors)
  validateLinkArray(v, 'relationships', 'character.relationships', errors)
  const arc = getArray(v, 'arc', 'character.arc', errors)
  if (arc) {
    arc.forEach((stage, i) => errors.push(...childErrors('character.arc', i, validateArcStage(stage))))
  }
  const tags = getArray(v, 'tags', 'character.tags', errors)
  if (tags) {
    tags.forEach((tag, i) =>
      errors.push(...childErrors('character.tags', i, validateCharacterTag(tag)))
    )
  }
  validateLinkArray(v, 'links', 'character.links', errors)
  expectString(v, 'createdAt', 'character.createdAt', errors)
  expectString(v, 'updatedAt', 'character.updatedAt', errors)
  return errors
}

export function validateWorldEntryV2(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['worldEntry: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'worldEntry.id', errors)
  expectString(v, 'title', 'worldEntry.title', errors, true)
  expectEnum(v, 'category', 'worldEntry.category', SETTING_CATEGORIES, errors)
  expectString(v, 'content', 'worldEntry.content', errors)
  expectStringOrNull(v, 'parentId', 'worldEntry.parentId', errors)
  expectNumber(v, 'order', 'worldEntry.order', errors)
  expectStringArray(v, 'tags', 'worldEntry.tags', errors)
  validateLinkArray(v, 'links', 'worldEntry.links', errors)
  expectString(v, 'createdAt', 'worldEntry.createdAt', errors)
  expectString(v, 'updatedAt', 'worldEntry.updatedAt', errors)
  return errors
}

function validatePlotlineStage(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['plotlineStage: expected object, got ' + typeName(v)]
  expectString(v, 'title', 'plotlineStage.title', errors, true)
  expectString(v, 'summary', 'plotlineStage.summary', errors)
  expectStringArray(v, 'chapterIds', 'plotlineStage.chapterIds', errors)
  expectStringArray(v, 'entityIds', 'plotlineStage.entityIds', errors)
  return errors
}

export function validatePlotlineV2(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['plotline: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'plotline.id', errors)
  expectString(v, 'title', 'plotline.title', errors, true)
  expectString(v, 'summary', 'plotline.summary', errors)
  expectEnum(v, 'status', 'plotline.status', PLOTLINE_STATUSES, errors)
  const stages = getArray(v, 'stages', 'plotline.stages', errors)
  if (stages) {
    stages.forEach((stage, i) =>
      errors.push(...childErrors('plotline.stages', i, validatePlotlineStage(stage)))
    )
  }
  expectString(v, 'createdAt', 'plotline.createdAt', errors)
  expectString(v, 'updatedAt', 'plotline.updatedAt', errors)
  return errors
}

function validateChoiceOption(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['choiceOption: expected object, got ' + typeName(v)]
  expectString(v, 'label', 'choiceOption.label', errors, true)
  expectString(v, 'consequence', 'choiceOption.consequence', errors)
  return errors
}

export function validateChoiceNodeV2(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['choiceNode: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'choiceNode.id', errors)
  expectString(v, 'title', 'choiceNode.title', errors, true)
  expectString(v, 'chapterId', 'choiceNode.chapterId', errors, true)
  const options = getArray(v, 'options', 'choiceNode.options', errors)
  if (options) {
    options.forEach((option, i) =>
      errors.push(...childErrors('choiceNode.options', i, validateChoiceOption(option)))
    )
  }
  expectString(v, 'createdAt', 'choiceNode.createdAt', errors)
  expectString(v, 'updatedAt', 'choiceNode.updatedAt', errors)
  return errors
}

export function validateForeshadowEntry(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['foreshadowEntry: expected object, got ' + typeName(v)]
  expectUuid(v, 'id', 'foreshadowEntry.id', errors)
  expectString(v, 'title', 'foreshadowEntry.title', errors, true)
  expectString(v, 'plantedChapterId', 'foreshadowEntry.plantedChapterId', errors, true)
  expectString(v, 'plannedPayoffNote', 'foreshadowEntry.plannedPayoffNote', errors)
  expectStringOrNull(v, 'resolvedChapterId', 'foreshadowEntry.resolvedChapterId', errors)
  expectEnum(v, 'status', 'foreshadowEntry.status', FORESHADOW_STATUSES, errors)
  expectOptionalString(v, 'note', 'foreshadowEntry.note', errors)
  return errors
}

export function validateForeshadowLedger(v: unknown): string[] {
  const errors: Errors = []
  if (!isRecord(v)) return ['ledger: expected object, got ' + typeName(v)]
  const entries = getArray(v, 'entries', 'ledger.entries', errors)
  if (entries) {
    entries.forEach((entry, i) =>
      errors.push(...childErrors('ledger.entries', i, validateForeshadowEntry(entry)))
    )
  }
  return errors
}
