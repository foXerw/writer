// v1 → v2 就地迁移器（语义 1-7 钉死在 M2 计划 Task 3）+ project:create 的 v2 骨架。
// 数据安全纪律：
// - 任何改写前先整本时间戳备份（不含既有 .migration-backup，绝不套娃/覆盖）；备份失败 → 抛错，书目录原样未动；
// - book.json 已存在 → 拒绝重入（ALREADY_MIGRATED）——幂等由 project:open 的 detectFormat 门 + 本函数双保险；
// - v1 根配置（.novelwriter.json）不可解析 → 抛 CORRUPT_BOOK（fail-closed，绝不猜测书名重建）；
// - 单个 v1 实体文件损坏 → warnings 记 `跳过损坏文件: <name>` 继续，整体不抛。
//
// 关系映射裁定（brief 语义4 的「kind=relationship, note=description」按字段名对读）：
// v1 CharacterRelationship.relationship 是必填的关系标签（'朋友' 等），kind 取该标签、
// 缺失时回退字面量 'relationship'，note 取 description——v1 必填字段一个不丢（原件另有备份兜底）。
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  BookMeta,
  ChapterMeta,
  CharacterV2,
  EntityLink,
  ForeshadowLedger,
  WorldEntryV2
} from '../../../src/common/schema'
import {
  FORMAT_VERSION,
  PROJECT_TYPES,
  SETTING_CATEGORIES,
  UUID_PATTERN,
  validateBookMeta,
  validateCharacterV2,
  validateForeshadowLedger,
  validateVolumeDoc,
  validateWorldEntryV2
} from '../../../src/common/schema'
import type {
  MigrationReport,
  ProjectConfig,
  ProjectType,
  SettingCategory
} from '../../../src/common/ipc'
import { parseChapterDoc, serializeChapterDoc } from '../../../src/common/chapterDoc'
import { listYamlFiles, readYamlFile, writeTextFileAtomic, writeYamlFileAtomic } from './docStore'
import { V1_MARKER_FILE, V1_MIGRATED_FILE } from './format'
import {
  BACKUP_DIR_NAME,
  backupStamp,
  bookJsonPath,
  chapterFile,
  chaptersDir,
  characterFile,
  charactersDir,
  foreshadowFile,
  volumesDir,
  worldDir,
  worldEntryFile
} from './paths'

/** v1 书目录里设定文件的根目录名（v1 setting.ts 钉死）。 */
const V1_SETTINGS_DIR = 'settings'

/** v1 project:create 的默认配置（缺失键回填用，与 v1 行为一致）。 */
const V1_DEFAULT_CONFIG: ProjectConfig = {
  wordCountGoal: 0,
  dailyGoal: 2000,
  autoSave: true,
  autoSaveInterval: 30000
}

export function migrateBook(projectPath: string): MigrationReport {
  // 防重入双保险：book.json 已存在 → 绝不再动手术（Review Focus 1：反复打开不得二次迁移/二份备份）
  if (existsSync(bookJsonPath(projectPath))) {
    throw new Error(`ALREADY_MIGRATED: ${projectPath} 已有 book.json（v2），拒绝重复迁移`)
  }
  const markerPath = join(projectPath, V1_MARKER_FILE)
  const migratedPath = join(projectPath, V1_MIGRATED_FILE)
  // 半迁移救援：标记已改名 .migrated 而 book.json 未落成 → 以 .migrated 为配置源继续完成迁移
  const marker = existsSync(markerPath)
    ? markerPath
    : existsSync(migratedPath)
      ? migratedPath
      : null
  if (!marker) {
    throw new Error(`CORRUPT_BOOK: ${projectPath} — 未找到 v1 项目标记（${V1_MARKER_FILE}）`)
  }
  const v1Config = parseV1Json(marker)
  if (!isRecord(v1Config)) {
    throw new Error(`CORRUPT_BOOK: ${marker} — v1 项目配置不可解析或不是对象，未做任何修改`)
  }

  const warnings: string[] = []

  // 语义1：先备份后动刀；复制失败 → 抛错，书目录原样未动
  const backupPath = createBackup(projectPath)

  // 语义2：.novelwriter.json → book.json
  writeYamlFileAtomic(bookJsonPath(projectPath), toBookMeta(v1Config, warnings))
  // 语义3：chapters/NNN-标题.md → chapters/<uuid>.md（front-matter + 正文原样）
  migrateChapters(projectPath)
  // 语义4：characters/<id>.json → characters/<id>.yaml（关系 name→id 仅唯一匹配连边）
  migrateCharacters(projectPath, warnings)
  // 语义5：settings/<cat>/<…>.json → world/<cat>/<全id>.yaml（parentId 经 old→new 映射）
  migrateSettings(projectPath, warnings)

  // 语义6：空伏笔台账 + 标记改名（此后 detectFormat 见 book.json 即 v2 —— 幂等关键）
  const ledger: ForeshadowLedger = { entries: [] }
  writeYamlFileAtomic(foreshadowFile(projectPath), ledger)
  if (existsSync(markerPath)) {
    renameSync(markerPath, migratedPath)
  }

  // 语义7
  return { backupPath, warnings }
}

/**
 * 迁移后自检：每个 YAML 过 Task 1 校验器、章节 front-matter 可读、order 无重复。
 * 永不抛错（单文件问题进错误串）；调用方（project:open）仅记日志不阻塞。
 */
export function validateMigration(projectPath: string): string[] {
  const errors: string[] = []

  try {
    for (const e of validateBookMeta(readYamlFile<unknown>(bookJsonPath(projectPath)))) {
      errors.push(`book.json: ${e}`)
    }
  } catch (err) {
    errors.push(`book.json: ${errMessage(err)}`)
  }

  const volDir = volumesDir(projectPath)
  for (const file of listYamlFiles(volDir)) {
    try {
      for (const e of validateVolumeDoc(readYamlFile<unknown>(join(volDir, file)))) {
        errors.push(`volumes/${file}: ${e}`)
      }
    } catch (err) {
      errors.push(`volumes/${file}: ${errMessage(err)}`)
    }
  }

  const chDir = chaptersDir(projectPath)
  const orders = new Map<number, string[]>()
  if (existsSync(chDir)) {
    const mdFiles = readdirSync(chDir)
      .filter((f) => f.endsWith('.md') && statSync(join(chDir, f)).isFile())
      .sort((a, b) => a.localeCompare(b))
    for (const file of mdFiles) {
      try {
        // parseChapterDoc 自带 validateChapterMeta（FRONTMATTER_MISSING / FRONTMATTER_INVALID）
        const { meta } = parseChapterDoc(
          readFileSync(join(chDir, file), 'utf8'),
          `chapters/${file}`
        )
        const seen = orders.get(meta.order) ?? []
        seen.push(file)
        orders.set(meta.order, seen)
      } catch (err) {
        errors.push(`chapters/${file}: ${errMessage(err)}`)
      }
    }
  }
  for (const [order, files] of orders) {
    if (files.length > 1) errors.push(`chapters: order ${order} 重复: ${files.join(', ')}`)
  }

  const charDir = charactersDir(projectPath)
  for (const file of listYamlFiles(charDir)) {
    try {
      for (const e of validateCharacterV2(readYamlFile<unknown>(join(charDir, file)))) {
        errors.push(`characters/${file}: ${e}`)
      }
    } catch (err) {
      errors.push(`characters/${file}: ${errMessage(err)}`)
    }
  }

  const wDir = worldDir(projectPath)
  if (existsSync(wDir)) {
    const subs = readdirSync(wDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
    for (const sub of subs) {
      for (const file of listYamlFiles(join(wDir, sub))) {
        try {
          for (const e of validateWorldEntryV2(readYamlFile<unknown>(join(wDir, sub, file)))) {
            errors.push(`world/${sub}/${file}: ${e}`)
          }
        } catch (err) {
          errors.push(`world/${sub}/${file}: ${errMessage(err)}`)
        }
      }
    }
  }

  try {
    for (const e of validateForeshadowLedger(readYamlFile<unknown>(foreshadowFile(projectPath)))) {
      errors.push(`foreshadow.yaml: ${e}`)
    }
  } catch (err) {
    errors.push(`foreshadow.yaml: ${errMessage(err)}`)
  }

  return errors
}

/** project:create 的 v2 骨架：book.json + 四个实体目录 + 空台账；不写任何 v1 标记。 */
export function createBookSkeleton(projectDir: string, name: string, type: ProjectType): BookMeta {
  const meta: BookMeta = {
    id: randomUUID(),
    name,
    type,
    formatVersion: FORMAT_VERSION,
    config: { ...V1_DEFAULT_CONFIG },
    synopsis: ''
  }
  for (const dir of [
    chaptersDir(projectDir),
    volumesDir(projectDir),
    charactersDir(projectDir),
    worldDir(projectDir)
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  writeYamlFileAtomic(bookJsonPath(projectDir), meta)
  const ledger: ForeshadowLedger = { entries: [] }
  writeYamlFileAtomic(foreshadowFile(projectDir), ledger)
  return meta
}

// ---------------------------------------------------------------------------
// 语义1：时间戳整本备份
// ---------------------------------------------------------------------------

function createBackup(projectPath: string): string {
  // backupStamp 已含 `.migration-backup/` 前缀并消毒 ':'——唯一正确组合是 join(projectPath, stamp)
  const base = join(projectPath, backupStamp(new Date().toISOString()))
  let dest = base
  let suffix = 2
  while (existsSync(dest)) {
    dest = `${base}-${suffix++}` // 既有备份永不覆盖
  }
  try {
    // cpSync 整目录复制进自身子目录会被 Node 的 self-copy 防护拒绝（实测
    // "Cannot copy … to a subdirectory of self"）——改为逐顶层条目复制，跳过 .migration-backup。
    // 新建的 dest 就在 .migration-backup 之下，被同一条跳过规则天然排除，无套娃/无递归。
    mkdirSync(dest, { recursive: true })
    for (const entry of readdirSync(projectPath, { withFileTypes: true })) {
      if (entry.name === BACKUP_DIR_NAME) continue
      cpSync(join(projectPath, entry.name), join(dest, entry.name), { recursive: true })
    }
  } catch (err) {
    // 半途失败：清掉残缺备份，书目录此时尚未被写过任何字节
    rmSync(dest, { recursive: true, force: true })
    throw new Error(`迁移备份失败，书目录未做任何修改: ${errMessage(err)}`)
  }
  return dest
}

// ---------------------------------------------------------------------------
// 语义2：book.json
// ---------------------------------------------------------------------------

function toBookMeta(v1: Record<string, unknown>, warnings: string[]): BookMeta {
  let name = '未命名书'
  if (typeof v1.name === 'string' && v1.name.trim() !== '') {
    name = v1.name
  } else {
    warnings.push('book.json: v1 name 缺失，已置为「未命名书」')
  }
  let type: ProjectType = 'novel'
  if (isProjectType(v1.type)) {
    type = v1.type
  } else {
    warnings.push(`book.json: v1 type 无效（${String(v1.type)}），已置为 novel`)
  }
  const s = isRecord(v1.settings) ? v1.settings : {}
  if (!isRecord(v1.settings)) {
    warnings.push('book.json: v1 settings 缺失，已用默认配置')
  }
  const config: ProjectConfig = {
    wordCountGoal: numOr(s.wordCountGoal, V1_DEFAULT_CONFIG.wordCountGoal),
    dailyGoal: numOr(s.dailyGoal, V1_DEFAULT_CONFIG.dailyGoal),
    autoSave: typeof s.autoSave === 'boolean' ? s.autoSave : V1_DEFAULT_CONFIG.autoSave,
    autoSaveInterval: numOr(s.autoSaveInterval, V1_DEFAULT_CONFIG.autoSaveInterval)
  }
  return { id: randomUUID(), name, type, formatVersion: FORMAT_VERSION, config, synopsis: '' }
}

// ---------------------------------------------------------------------------
// 语义3：章节
// ---------------------------------------------------------------------------

function migrateChapters(projectPath: string): void {
  const dir = chaptersDir(projectPath)
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile())
    .sort((a, b) => a.localeCompare(b))
  files.forEach((file, index) => {
    const abs = join(dir, file)
    const raw = readFileSync(abs, 'utf8')
    // 半迁移救援：已带合法 front-matter 的文件视为 v2 成品，原样不动
    if (isAlreadyV2Chapter(raw)) return
    const stem = file.slice(0, -'.md'.length)
    const numbered = stem.match(/^(\d+)-(.*)$/)
    const order = numbered ? parseInt(numbered[1], 10) : index + 1
    // 与 v1 chapter:getAll 同款正则（首个顶格 `# ` 行）→ 迁移后标题与 v1 展示一致（Review Focus 1）
    const heading = raw.match(/^#\s+(.+)$/m)
    let title: string
    if (heading) title = heading[1]
    else if (numbered && numbered[2] !== '') title = numbered[2]
    else if (stem !== '') title = stem
    else title = file
    const meta: ChapterMeta = {
      id: randomUUID(),
      title,
      volumeId: null, // 显式 null（ChapterMeta.volumeId 必填，不许 undefined）
      order,
      status: 'draft'
    }
    // 正文原样：v1 全文（含 `# 标题` 行）就是 v2 body，与 Task 4 createChapter 手感一致
    writeTextFileAtomic(chapterFile(projectPath, meta.id), serializeChapterDoc(meta, raw))
    rmSync(abs, { force: true })
  })
}

function isAlreadyV2Chapter(raw: string): boolean {
  try {
    parseChapterDoc(raw)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 语义4：角色
// ---------------------------------------------------------------------------

function migrateCharacters(projectPath: string, warnings: string[]): void {
  const dir = charactersDir(projectPath)
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && statSync(join(dir, f)).isFile())
    .sort((a, b) => a.localeCompare(b))

  const parsed: { file: string; id: string; raw: Record<string, unknown> }[] = []
  for (const file of files) {
    const obj = parseV1Json(join(dir, file))
    if (!isRecord(obj) || typeof obj.id !== 'string' || obj.id === '') {
      warnings.push(`跳过损坏文件: ${file}`)
      continue
    }
    parsed.push({ file, id: obj.id, raw: obj })
  }

  // 全库 name → ids：唯一匹配才连边的判定基础（重名 = 歧义 = 丢弃）
  const nameToIds = new Map<string, string[]>()
  for (const { id, raw } of parsed) {
    if (typeof raw.name !== 'string' || raw.name === '') continue
    const ids = nameToIds.get(raw.name) ?? []
    ids.push(id)
    nameToIds.set(raw.name, ids)
  }

  const now = new Date().toISOString()
  for (const { file, id, raw } of parsed) {
    const selfName = typeof raw.name === 'string' ? raw.name : ''
    const relationships: EntityLink[] = []
    if (Array.isArray(raw.relationships)) {
      for (const rel of raw.relationships) {
        if (!isRecord(rel)) continue
        const targetName = typeof rel.characterName === 'string' ? rel.characterName : ''
        const candidates = nameToIds.get(targetName) ?? []
        if (candidates.length === 1) {
          const link: EntityLink = { targetId: candidates[0], kind: relationshipKind(rel.relationship) }
          if (typeof rel.description === 'string' && rel.description !== '') {
            link.note = rel.description
          }
          relationships.push(link)
        } else {
          warnings.push(`关系丢弃: ${selfName}→${targetName}`)
        }
      }
    }

    const v2: CharacterV2 = {
      id,
      name: selfName,
      // 其余字段平移：原样搬运，值非法交给 validateMigration 报告（不猜、不改数据）
      gender: raw.gender as CharacterV2['gender'],
      age: raw.age as number,
      role: raw.role as CharacterV2['role'],
      appearance: raw.appearance as string,
      personality: raw.personality as string,
      background: raw.background as string,
      relationships,
      arc: [], // v1 无成长弧线
      tags: (Array.isArray(raw.tags) ? raw.tags : []) as CharacterV2['tags'],
      links: [], // v1 无通用链接
      createdAt: isoOr(raw.createdAt, now), // v1 JSON 里 Date 已序列化为 ISO 字符串，平移即可
      updatedAt: isoOr(raw.updatedAt, now)
    }
    if (typeof raw.avatar === 'string') v2.avatar = raw.avatar
    if (typeof raw.goals === 'string') v2.goals = raw.goals
    if (typeof raw.flaws === 'string') v2.flaws = raw.flaws
    if (typeof raw.notes === 'string') v2.notes = raw.notes

    writeYamlFileAtomic(characterFile(projectPath, v2.id), v2)
    rmSync(join(dir, file), { force: true })
  }
}

function relationshipKind(v: unknown): string {
  // kind = v1 relationship 标签（'朋友' 等）；缺失/空白回退字面量 'relationship'（校验器要求非空）
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : 'relationship'
}

// ---------------------------------------------------------------------------
// 语义5：设定 → world
// ---------------------------------------------------------------------------

function migrateSettings(projectPath: string, warnings: string[]): void {
  const root = join(projectPath, V1_SETTINGS_DIR)
  if (!existsSync(root) || !statSync(root).isDirectory()) return

  // 递归收集（与 v1 setting:getAll 的递归一致）
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(abs)
    }
  }
  walk(root)
  found.sort((a, b) => a.localeCompare(b))

  const parsed: { abs: string; id: string; raw: Record<string, unknown> }[] = []
  for (const abs of found) {
    const obj = parseV1Json(abs)
    if (!isRecord(obj) || typeof obj.id !== 'string' || obj.id === '') {
      warnings.push(`跳过损坏文件: ${basename(abs)}`)
      continue
    }
    parsed.push({ abs, id: obj.id, raw: obj })
  }

  // 旧全 id → 新 id 映射：文件内容里 id 是全量 UUID 则不变；前缀 id 等历史场景重建 UUID（remap 依据）
  const idMap = new Map<string, string>()
  for (const { abs, id, raw } of parsed) {
    if (UUID_PATTERN.test(id)) {
      idMap.set(id, id)
    } else {
      idMap.set(id, randomUUID())
      warnings.push(`设定 id 重建: ${settingLabel(raw, abs)}`)
    }
  }

  const now = new Date().toISOString()
  for (const { abs, id, raw } of parsed) {
    const newId = idMap.get(id)
    if (!newId) continue // 不可达：上一步已全量入 map
    const label = settingLabel(raw, abs)
    const category = toCategory(raw.category, basename(dirname(abs)), label, warnings)

    let parentId: string | null = null
    if (typeof raw.parentId === 'string' && raw.parentId !== '') {
      const mapped = idMap.get(raw.parentId)
      if (mapped) {
        parentId = mapped
      } else {
        warnings.push(`设定 parentId 悬挂置空: ${label} → ${raw.parentId}`)
      }
    }

    const v2: WorldEntryV2 = {
      id: newId, // settings 保留文件内容里的全量 id 作为新文件名 id
      title: typeof raw.title === 'string' ? raw.title : '',
      category,
      content: typeof raw.content === 'string' ? raw.content : '',
      parentId,
      order: typeof raw.order === 'number' ? raw.order : 0,
      tags: (Array.isArray(raw.tags) ? raw.tags : []) as string[],
      links: [], // v1 无词条互链
      createdAt: isoOr(raw.createdAt, now),
      updatedAt: isoOr(raw.updatedAt, now)
    }
    writeYamlFileAtomic(worldEntryFile(projectPath, category, newId), v2)
    rmSync(abs, { force: true })
  }

  pruneEmptyDirs(root) // 仅移除清空后的目录；残留损坏文件的目录原样保留
}

function toCategory(
  value: unknown,
  dirName: string,
  label: string,
  warnings: string[]
): SettingCategory {
  if (isSettingCategory(value)) return value
  if (isSettingCategory(dirName)) {
    warnings.push(`设定分类无效回退目录名: ${label}（${String(value)} → ${dirName}）`)
    return dirName
  }
  warnings.push(`设定分类无效置 other: ${label}（${String(value)}）`)
  return 'other'
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function pruneEmptyDirs(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(join(dir, entry.name))
  }
  // 仅在确认清空后删除（rmSync 删目录需 recursive；此刻目录必为空）
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
}

function parseV1Json(abs: string): unknown {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch {
    return undefined
  }
}

function settingLabel(raw: Record<string, unknown>, abs: string): string {
  return typeof raw.title === 'string' && raw.title !== '' ? raw.title : basename(abs)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isProjectType(v: unknown): v is ProjectType {
  return typeof v === 'string' && (PROJECT_TYPES as readonly string[]).includes(v)
}

function isSettingCategory(v: unknown): v is SettingCategory {
  return typeof v === 'string' && (SETTING_CATEGORIES as readonly string[]).includes(v)
}

function isoOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
