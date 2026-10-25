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
import { basename, dirname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  BookMeta,
  ChapterDoc,
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
  backupRoot,
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
  const markerPath = join(projectPath, V1_MARKER_FILE)
  const migratedPath = join(projectPath, V1_MIGRATED_FILE)
  const bookExists = existsSync(bookJsonPath(projectPath))
  const markerExists = existsSync(markerPath)

  // 幂等门（Review Focus 1）：成功的迁移以「标记改名 .migrated」收尾——
  // - book.json 在 + 旧标记已改名/不在 = 完成态 → 绝不再动手术（ALREADY_MIGRATED）；
  // - book.json 在 + .novelwriter.json 仍在 = 唯一无歧义的中断态（写了 book.json 后崩溃）→ 允许重入补完；
  // - book.json 不在 → 全新迁移或半迁移救援（.migrated 作配置源）。
  if (bookExists && !markerExists) {
    throw new Error(`ALREADY_MIGRATED: ${projectPath} 已有 book.json（v2），拒绝重复迁移`)
  }
  const marker = markerExists ? markerPath : existsSync(migratedPath) ? migratedPath : null
  if (!marker) {
    throw new Error(`CORRUPT_BOOK: ${projectPath} — 未找到 v1 项目标记（${V1_MARKER_FILE}）`)
  }
  const v1Config = parseV1Json(marker)
  if (!isRecord(v1Config)) {
    throw new Error(`CORRUPT_BOOK: ${marker} — v1 项目配置不可解析或不是对象，未做任何修改`)
  }

  const warnings: string[] = []
  const resuming = bookExists // 走到这里必然 markerExists

  // 语义1：先备份后动刀；复制失败 → 抛错，书目录原样未动。
  // 续迁复用崩溃 run 留下的备份（那份才是原始 v1 状态），不产生重复备份。
  const backupPath = resuming ? resumeBackup(projectPath) : createBackup(projectPath)

  // 语义2：.novelwriter.json → book.json（续迁不重写——已落盘的书 id 必须稳定保留）
  if (!resuming) {
    writeYamlFileAtomic(bookJsonPath(projectPath), toBookMeta(v1Config, warnings))
  }
  // 语义3：chapters/NNN-标题.md → chapters/<uuid>.md（front-matter + 正文原样；已是 v2 的跳过）
  migrateChapters(projectPath)
  // 语义4：characters/<id>.json → characters/<id>.yaml（关系边：characterId 直解 → 唯一名字 → 丢弃+warning）
  migrateCharacters(projectPath, warnings)
  // 语义5：settings/<cat>/<…>.json → world/<cat>/<全id>.yaml（parentId 经 old→new 映射）
  migrateSettings(projectPath, warnings)

  // 语义6：空伏笔台账（已存在则不覆盖——续迁/外部台账数据不可毁）+ 标记改名（幂等关键）
  if (!existsSync(foreshadowFile(projectPath))) {
    const ledger: ForeshadowLedger = { entries: [] }
    writeYamlFileAtomic(foreshadowFile(projectPath), ledger)
  }
  if (existsSync(markerPath)) {
    renameSync(markerPath, migratedPath)
  }

  // 语义7
  return { backupPath, warnings }
}

/**
 * 迁移后自检：每个 YAML 过 Task 1 校验器、章节 front-matter 可读、order 无重复、v1 残留扫描。
 * 永不外抛（单文件问题进错误串；整体异常兜底为 `自检异常: …`）；调用方（project:open）仅记日志不阻塞。
 */
export function validateMigration(projectPath: string): string[] {
  try {
    return collectValidationIssues(projectPath)
  } catch (err) {
    // 全函数兜底：readdirSync/statSync 等文件系统操作在任何一段都可能抛（路径被文件占位等），
    // 自检永远不许把裸异常抛穿 project:open
    return [`自检异常: ${errMessage(err)}`]
  }
}

function collectValidationIssues(projectPath: string): string[] {
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

  // v1 残留扫描：迁移中断/未完成的痕迹（detectFormat 对此盲区，这里补上）
  if (existsSync(charDir)) {
    for (const f of readdirSync(charDir)) {
      if (f.endsWith('.json')) errors.push(`v1 残留: ${join('characters', f)}`)
    }
  }
  if (existsSync(chDir)) {
    for (const f of readdirSync(chDir)) {
      // NNN- 前缀 = v1 命名；但 v2 uuid 文件名首段可能全是数字（如 11111111-…），须排除 uuid 名
      if (
        f.endsWith('.md') &&
        /^\d+-/.test(f) &&
        !UUID_PATTERN.test(f.slice(0, -'.md'.length))
      ) {
        errors.push(`v1 残留: ${join('chapters', f)}`)
      }
    }
  }
  const settingsRoot = join(projectPath, V1_SETTINGS_DIR)
  if (existsSync(settingsRoot) && statSync(settingsRoot).isDirectory()) {
    for (const abs of collectJsonFilesRecursive(settingsRoot)) {
      errors.push(`v1 残留: ${relative(projectPath, abs)}`)
    }
  }

  return errors
}

/** project:create 的 v2 骨架：book.json + 四个实体目录 + 空台账；不写任何 v1 标记。 */
export function createBookSkeleton(projectDir: string, name: string, type: ProjectType): BookMeta {
  // 拒绝覆盖既有书：BOOK_EXISTS 必须在任何写盘之前抛出（v1 时代的静默覆盖不可接受；渲染层文案归 Task 10）
  if (existsSync(bookJsonPath(projectDir))) {
    throw new Error(`BOOK_EXISTS: ${projectDir}`)
  }
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

/** 续迁场景：崩溃 run 已建过备份 → 复用其中最新的一份（时间戳目录名按字典序即时间序）；没有则补建。 */
function resumeBackup(projectPath: string): string {
  const root = backupRoot(projectPath)
  if (existsSync(root) && statSync(root).isDirectory()) {
    const stamps = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
    if (stamps.length > 0) return join(root, stamps[stamps.length - 1])
  }
  return createBackup(projectPath)
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

  // 第一遍：识别待转 v1 文件；收集既有 order 上限——含续迁场景已转好的 v2 文件的 front-matter order
  const pending: { file: string; raw: string; numberedOrder: number | null }[] = []
  let maxOrder = 0
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8')
    const done = tryParseV2Chapter(raw)
    if (done) {
      // 半迁移救援/续迁：已带合法 front-matter 的文件视为 v2 成品，原样不动，但其 order 参与上限
      maxOrder = Math.max(maxOrder, done.meta.order)
      continue
    }
    const stem = file.slice(0, -'.md'.length)
    const numbered = stem.match(/^(\d+)-(.*)$/)
    const order = numbered ? parseInt(numbered[1], 10) : null
    if (order !== null) maxOrder = Math.max(maxOrder, order)
    pending.push({ file, raw, numberedOrder: order })
  }

  // 第二遍：转换。有编号用编号；无编号回退 max+n 递增——绝不用列表位次（会与既有编号相撞，如 002-b.md + 番外.md 同为 2）
  for (const item of pending) {
    const abs = join(dir, item.file)
    const stem = item.file.slice(0, -'.md'.length)
    const numbered = stem.match(/^(\d+)-(.*)$/)
    const order = item.numberedOrder !== null ? item.numberedOrder : ++maxOrder
    // 与 v1 chapter:getAll 同款正则（首个顶格 `# ` 行）→ 迁移后标题与 v1 展示一致（Review Focus 1）
    const heading = item.raw.match(/^#\s+(.+)$/m)
    let title: string
    if (heading) title = heading[1]
    else if (numbered && numbered[2] !== '') title = numbered[2]
    else if (stem !== '') title = stem
    else title = item.file
    const meta: ChapterMeta = {
      id: randomUUID(),
      title,
      volumeId: null, // 显式 null（ChapterMeta.volumeId 必填，不许 undefined）
      order,
      status: 'draft'
    }
    // 正文原样：v1 全文（含 `# 标题` 行）就是 v2 body，与 Task 4 createChapter 手感一致
    writeTextFileAtomic(chapterFile(projectPath, meta.id), serializeChapterDoc(meta, item.raw))
    rmSync(abs, { force: true })
  }
}

function tryParseV2Chapter(raw: string): ChapterDoc | null {
  try {
    return parseChapterDoc(raw)
  } catch {
    return null
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

  // 全库 id 集合 + name → ids：characterId 直解与唯一名匹配的判定基础（重名 = 歧义）
  const idSet = new Set<string>(parsed.map((p) => p.id))
  const nameToIds = new Map<string, string[]>()
  const registerName = (name: string, charId: string): void => {
    const ids = nameToIds.get(name) ?? []
    ids.push(charId)
    nameToIds.set(name, ids)
  }
  for (const { id, raw } of parsed) {
    if (typeof raw.name === 'string' && raw.name !== '') registerName(raw.name, id)
  }
  // 续迁场景：已转好的 characters/*.yaml 也参与 characterId 直解与重名歧义判定
  // （否则崩溃 run 已转的角色会从名册消失，指向它的边被误判"无匹配"而丢弃）
  for (const file of listYamlFiles(dir)) {
    try {
      const doc = readYamlFile<unknown>(join(dir, file))
      if (!isRecord(doc) || typeof doc.id !== 'string' || doc.id === '' || idSet.has(doc.id)) continue
      idSet.add(doc.id)
      if (typeof doc.name === 'string' && doc.name !== '') registerName(doc.name, doc.id)
    } catch {
      // 损坏 yaml 不参与解析；validateMigration 的残留/校验扫描会报告
    }
  }

  const now = new Date().toISOString()
  for (const { file, id, raw } of parsed) {
    const selfName = typeof raw.name === 'string' ? raw.name : ''
    const relationships: EntityLink[] = []
    if (Array.isArray(raw.relationships)) {
      for (const rel of raw.relationships) {
        if (!isRecord(rel)) continue
        const targetName = typeof rel.characterName === 'string' ? rel.characterName : ''
        // 救援顺序：1) v1 characterId 在本书角色 id 集内 → 直解（名字歧义也能救回）；
        //           2) 名字全库唯一匹配；3) 都不行 → 丢弃 + warning
        const cid = typeof rel.characterId === 'string' ? rel.characterId : ''
        const byId = cid !== '' && idSet.has(cid) ? cid : null
        const candidates = nameToIds.get(targetName) ?? []
        const targetId = byId ?? (candidates.length === 1 ? candidates[0] : null)
        if (targetId !== null) {
          const link: EntityLink = { targetId, kind: relationshipKind(rel.relationship) }
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
  const found = collectJsonFilesRecursive(root)

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
  // 续迁场景：已转好的 world yaml（文件名 stem 即 id）也入映射，
  // 防止指向它们的 parentId 被误判悬挂而置空
  const wDirExisting = worldDir(projectPath)
  if (existsSync(wDirExisting) && statSync(wDirExisting).isDirectory()) {
    for (const sub of readdirSync(wDirExisting, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      for (const file of listYamlFiles(join(wDirExisting, sub.name))) {
        const yamlId = file.slice(0, -'.yaml'.length)
        if (!idMap.has(yamlId)) idMap.set(yamlId, yamlId)
      }
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

/** 递归收集目录下全部 .json 文件（绝对路径，排序稳定）。 */
function collectJsonFilesRecursive(root: string): string[] {
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
  return found
}

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
