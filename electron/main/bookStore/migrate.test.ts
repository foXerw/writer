import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import { createBookSkeleton, migrateBook, validateMigration } from './migrate'
import { detectFormat } from './format'
import { readYamlFile } from './docStore'
import {
  BACKUP_DIR_NAME,
  backupRoot,
  bookJsonPath,
  chaptersDir,
  characterFile,
  charactersDir,
  foreshadowFile,
  volumesDir,
  worldDir,
  worldEntryFile
} from './paths'
import { parseChapterDoc } from '../../../src/common/chapterDoc'
import {
  UUID_PATTERN,
  validateBookMeta,
  type BookMeta,
  type CharacterV2,
  type ForeshadowLedger,
  type WorldEntryV2
} from '../../../src/common/schema'
import type { MigrationReport } from '../../../src/common/ipc'

// ---------------------------------------------------------------------------
// 样本书常量（brief Step 3：2 章、3 角色含一对重名"阿明"、幽灵关系、2 设定含 1 悬挂 parentId）
// ---------------------------------------------------------------------------

const UUID_AMING_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_AMING_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_LISI = 'cccccccc-3333-4333-8333-333333333333'
const UUID_SHAN = 'dddddddd-4444-4444-8444-444444444444'
const UUID_SEN = 'eeeeeeee-5555-4555-8555-555555555555'
const UUID_GHOST_PARENT = 'ffffffff-6666-4666-8666-666666666666'

const V1_CONFIG = {
  name: '星海拾荒者',
  type: 'novel',
  version: '1.0.0',
  settings: { wordCountGoal: 100, dailyGoal: 2000, autoSave: true, autoSaveInterval: 30000 }
}

const CH1_RAW = '# 黎明\n\n第一段。\n\n第二段。\n'
const CH2_RAW = '没有标题行的正文。\n'

/** v1 setting:create 的真实文件名手术：`${id}-${title}.json` 非 ASCII → '_' */
function v1SettingFileName(id: string, title: string): string {
  return `${id}-${title}.json`.replace(/[^a-zA-Z0-9\-_.]/g, '_')
}

function writeJson(abs: string, obj: unknown): void {
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(obj, null, 2), 'utf8')
}

function v1Character(id: string, name: string, relationships: unknown[]): Record<string, unknown> {
  return {
    id,
    name,
    gender: 'male',
    age: 17,
    role: 'supporting',
    appearance: '黑发',
    personality: '沉默',
    background: '海边长大',
    relationships,
    tags: [{ id: 'tag-1', name: '主角团', color: '#ff0000' }],
    notes: '备注',
    createdAt: '2025-03-01T08:00:00.000Z',
    updatedAt: '2025-03-02T09:30:00.000Z'
  }
}

function makeV1Book(dir: string): void {
  writeJson(join(dir, '.novelwriter.json'), V1_CONFIG)

  mkdirSync(join(dir, 'chapters'), { recursive: true })
  writeFileSync(join(dir, 'chapters', '001-黎明.md'), CH1_RAW, 'utf8')
  writeFileSync(join(dir, 'chapters', '002-黄昏.md'), CH2_RAW, 'utf8')

  writeJson(
    characterFile(dir, UUID_AMING_A).replace('.yaml', '.json'),
    v1Character(UUID_AMING_A, '阿明', [
      { id: 'r1', characterId: UUID_LISI, characterName: '李四', relationship: '朋友', description: '青梅竹马' },
      { id: 'r2', characterId: UUID_AMING_B, characterName: '阿明', relationship: '兄弟' }
    ])
  )
  writeJson(
    characterFile(dir, UUID_AMING_B).replace('.yaml', '.json'),
    v1Character(UUID_AMING_B, '阿明', [])
  )
  writeJson(
    characterFile(dir, UUID_LISI).replace('.yaml', '.json'),
    v1Character(UUID_LISI, '李四', [
      { id: 'r3', characterId: UUID_AMING_A, characterName: '阿明', relationship: '朋友' },
      { id: 'r4', characterId: 'no-such-id', characterName: '幽灵', relationship: '宿敌' }
    ])
  )

  writeJson(join(dir, 'settings', 'location', v1SettingFileName(UUID_SHAN, '青云山')), {
    id: UUID_SHAN,
    title: '青云山',
    category: 'location',
    content: '一座山',
    parentId: UUID_SEN,
    order: 1,
    tags: ['地理', '东方'],
    createdAt: '2025-04-01T00:00:00.000Z',
    updatedAt: '2025-04-02T00:00:00.000Z'
  })
  writeJson(join(dir, 'settings', 'location', v1SettingFileName(UUID_SEN, '迷雾森林')), {
    id: UUID_SEN,
    title: '迷雾森林',
    category: 'location',
    content: '一片林',
    parentId: UUID_GHOST_PARENT, // 悬挂：书里没有这个设定
    order: 2,
    tags: [],
    createdAt: '2025-04-03T00:00:00.000Z',
    updatedAt: '2025-04-04T00:00:00.000Z'
  })

  // 既有旧备份：迁移不得把它套娃复制进新备份
  mkdirSync(join(dir, BACKUP_DIR_NAME, '2020-01-01T00-00-00.000Z'), { recursive: true })
  writeFileSync(join(dir, BACKUP_DIR_NAME, '2020-01-01T00-00-00.000Z', 'old.txt'), '旧备份', 'utf8')
}

// ---------------------------------------------------------------------------
// 主场景
// ---------------------------------------------------------------------------

describe('migrateBook — 主场景（brief Step 3 样本书）', () => {
  let dir: string
  let report: MigrationReport

  beforeAll(() => {
    dir = mkTmpBook()
    makeV1Book(dir)
    report = migrateBook(dir)
  })

  it('语义2：book.json formatVersion=2，name/type/config 原样，synopsis 空，id 为 UUID', () => {
    const book = readYamlFile<BookMeta>(bookJsonPath(dir))

    expect(validateBookMeta(book)).toEqual([])
    expect(book.formatVersion).toBe(2)
    expect(book.name).toBe('星海拾荒者')
    expect(book.type).toBe('novel')
    expect(book.config).toEqual(V1_CONFIG.settings)
    expect(book.synopsis).toBe('')
    expect(UUID_PATTERN.test(book.id)).toBe(true)
  })

  it('语义3：章节文件数=2，文件名一律 <uuid>.md，v1 旧文件名清除', () => {
    const files = readdirSync(chaptersDir(dir))

    expect(files).toHaveLength(2)
    for (const f of files) {
      expect(f).toMatch(/\.md$/)
      expect(UUID_PATTERN.test(f.replace(/\.md$/, ''))).toBe(true)
    }
    expect(existsSync(join(chaptersDir(dir), '001-黎明.md'))).toBe(false)
  })

  it('语义3：front-matter title 首行 # 优先/否则文件名去 NNN- 前缀；order=文件名数字；正文原样', () => {
    const docs = readdirSync(chaptersDir(dir))
      .map((f) => parseChapterDoc(readFileSync(join(chaptersDir(dir), f), 'utf8'), f))
      .sort((a, b) => a.meta.order - b.meta.order)

    expect(docs.map((d) => d.meta.order)).toEqual([1, 2])
    expect(docs[0].meta.title).toBe('黎明')
    expect(docs[0].body).toBe(CH1_RAW) // 正文原样（含 v1 的 `# 标题` 行，与 Task 4 create 手感一致）
    expect(docs[1].meta.title).toBe('黄昏')
    expect(docs[1].body).toBe(CH2_RAW)
    for (const d of docs) {
      expect(d.meta.status).toBe('draft')
      expect(d.meta.volumeId).toBeNull() // 显式 null（ChapterMeta.volumeId 必填）
      expect(UUID_PATTERN.test(d.meta.id)).toBe(true)
    }
  })

  it('语义4：characters/<原id>.json → <原id>.yaml，字段平移，时间戳保持 ISO', () => {
    const c = readYamlFile<CharacterV2>(characterFile(dir, UUID_AMING_A))

    expect(existsSync(characterFile(dir, UUID_AMING_A).replace('.yaml', '.json'))).toBe(false)
    expect(readdirSync(charactersDir(dir)).filter((f) => f.endsWith('.json'))).toEqual([])
    expect(c.name).toBe('阿明')
    expect(c.gender).toBe('male')
    expect(c.age).toBe(17)
    expect(c.role).toBe('supporting')
    expect(c.appearance).toBe('黑发')
    expect(c.tags).toEqual([{ id: 'tag-1', name: '主角团', color: '#ff0000' }])
    expect(c.notes).toBe('备注')
    expect(c.arc).toEqual([])
    expect(c.links).toEqual([])
    expect(c.createdAt).toBe('2025-03-01T08:00:00.000Z')
    expect(c.updatedAt).toBe('2025-03-02T09:30:00.000Z')
  })

  it('语义4：唯一名"李四"连边成功（name→id），kind 取 v1 relationship 标签，note=description', () => {
    const c = readYamlFile<CharacterV2>(characterFile(dir, UUID_AMING_A))

    expect(c.relationships).toHaveLength(1)
    expect(c.relationships[0].targetId).toBe(UUID_LISI)
    expect(c.relationships[0].kind).toBe('朋友')
    expect(c.relationships[0].note).toBe('青梅竹马')
  })

  it('语义4：重名"阿明"歧义边与无匹配"幽灵"边全部丢弃并进 warnings', () => {
    expect(report.warnings).toContain('关系丢弃: 阿明→阿明')
    expect(report.warnings).toContain('关系丢弃: 李四→阿明')
    expect(report.warnings).toContain('关系丢弃: 李四→幽灵')

    const lisi = readYamlFile<CharacterV2>(characterFile(dir, UUID_LISI))
    expect(lisi.relationships).toEqual([])
    const amingB = readYamlFile<CharacterV2>(characterFile(dir, UUID_AMING_B))
    expect(amingB.relationships).toEqual([])
  })

  it('语义5：设定 → world/<cat>/<全id>.yaml，存活 parentId 保留，悬挂 parentId 置 null 并记 warning', () => {
    const shan = readYamlFile<WorldEntryV2>(worldEntryFile(dir, 'location', UUID_SHAN))
    const sen = readYamlFile<WorldEntryV2>(worldEntryFile(dir, 'location', UUID_SEN))

    expect(shan.title).toBe('青云山')
    expect(shan.category).toBe('location')
    expect(shan.content).toBe('一座山')
    expect(shan.parentId).toBe(UUID_SEN)
    expect(shan.order).toBe(1)
    expect(shan.tags).toEqual(['地理', '东方'])
    expect(shan.links).toEqual([])
    expect(shan.createdAt).toBe('2025-04-01T00:00:00.000Z')

    expect(sen.parentId).toBeNull()
    expect(report.warnings.some((w) => w.includes('parentId') && w.includes(UUID_GHOST_PARENT))).toBe(true)

    // v1 settings/ 源文件清除、空目录清干净
    expect(existsSync(join(dir, 'settings'))).toBe(false)
  })

  it('语义6：空 foreshadow.yaml 台账；.novelwriter.json 改名 .migrated', () => {
    expect(readYamlFile<ForeshadowLedger>(foreshadowFile(dir))).toEqual({ entries: [] })
    expect(existsSync(join(dir, '.novelwriter.json'))).toBe(false)
    expect(existsSync(join(dir, '.novelwriter.json.migrated'))).toBe(true)
  })

  it('语义1：备份是 backupRoot 直接子目录、ISO 消毒戳命名、无双重嵌套', () => {
    expect(dirname(report.backupPath)).toBe(backupRoot(dir))
    expect(basename(report.backupPath)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/)
    // backupStamp 已含 .migration-backup/ 前缀——组合只允许 join(projectPath, stamp)，出现两次即双重嵌套
    expect(report.backupPath.split(BACKUP_DIR_NAME)).toHaveLength(2)
    expect(existsSync(report.backupPath)).toBe(true)
  })

  it('语义1：备份内有原始 v1 文件；既有旧备份不被套娃复制', () => {
    expect(readFileSync(join(report.backupPath, '.novelwriter.json'), 'utf8')).toBe(
      JSON.stringify(V1_CONFIG, null, 2)
    )
    expect(readFileSync(join(report.backupPath, 'chapters', '001-黎明.md'), 'utf8')).toBe(CH1_RAW)
    expect(existsSync(join(report.backupPath, 'characters', `${UUID_AMING_A}.json`))).toBe(true)
    expect(existsSync(join(report.backupPath, 'settings', 'location'))).toBe(true)
    expect(existsSync(join(report.backupPath, BACKUP_DIR_NAME))).toBe(false)
  })

  it('语义6 幂等链路：迁移后 detectFormat=v2；重入 migrateBook 抛错且不产生第二份备份', () => {
    expect(detectFormat(dir)).toBe('v2')

    const before = readdirSync(backupRoot(dir))
    expect(() => migrateBook(dir)).toThrow('ALREADY_MIGRATED')
    expect(readdirSync(backupRoot(dir))).toEqual(before)
  })

  it('validateMigration 对迁移产物返回 []（自检全绿）', () => {
    expect(validateMigration(dir)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 损坏文件容错（brief Step 4：单文件坏 → warning 继续，整体不抛）
// ---------------------------------------------------------------------------

describe('migrateBook — 损坏文件容错', () => {
  let dir: string
  let report: MigrationReport

  beforeAll(() => {
    dir = mkTmpBook()
    writeJson(join(dir, '.novelwriter.json'), V1_CONFIG)
    mkdirSync(join(dir, 'chapters'), { recursive: true })
    writeFileSync(join(dir, 'chapters', '010-深夜.md'), '引子。\n\n# 深夜书房\n\n正文\n', 'utf8')
    writeFileSync(join(dir, 'chapters', '番外.md'), '无序号番外正文。\n', 'utf8')
    writeJson(join(dir, 'characters', `${UUID_LISI}.json`), v1Character(UUID_LISI, '李四', []))
    mkdirSync(join(dir, 'characters'), { recursive: true })
    writeFileSync(join(dir, 'characters', 'bad-char.json'), '{broken json', 'utf8')
    mkdirSync(join(dir, 'settings', 'history'), { recursive: true })
    writeFileSync(join(dir, 'settings', 'history', 'bad-setting.json'), 'not json at all', 'utf8')
    report = migrateBook(dir)
  })

  it('坏 JSON 单文件不抛整体，warnings 记 `跳过损坏文件: <name>` 并继续', () => {
    expect(report.warnings).toContain('跳过损坏文件: bad-char.json')
    expect(report.warnings).toContain('跳过损坏文件: bad-setting.json')
    // 好角色照常迁移
    expect(existsSync(characterFile(dir, UUID_LISI))).toBe(true)
  })

  it('标题在正文中部的 `# ` 行仍可提取（与 v1 chapter:getAll 展示一致）', () => {
    const docs = readdirSync(chaptersDir(dir))
      .map((f) => parseChapterDoc(readFileSync(join(chaptersDir(dir), f), 'utf8'), f))
      .sort((a, b) => a.meta.order - b.meta.order)
    const titles = docs.map((d) => d.meta.title)

    expect(titles).toContain('深夜书房')
    expect(titles).toContain('番外')
  })

  it('无数字前缀的章节文件也被迁移（order 回退排序位次），不留 v1 孤儿文件', () => {
    const files = readdirSync(chaptersDir(dir))
    expect(files).toHaveLength(2)
    expect(existsSync(join(chaptersDir(dir), '番外.md'))).toBe(false)
    const orders = files.map(
      (f) => parseChapterDoc(readFileSync(join(chaptersDir(dir), f), 'utf8'), f).meta.order
    )
    expect(new Set(orders).size).toBe(2) // order 无重复
  })
})

// ---------------------------------------------------------------------------
// 设定前缀 id remap（语义5："前缀 id 场景 remap"）
// ---------------------------------------------------------------------------

describe('migrateBook — 设定非 UUID 旧 id 重建 + parentId remap', () => {
  let dir: string
  let report: MigrationReport

  beforeAll(() => {
    dir = mkTmpBook()
    writeJson(join(dir, '.novelwriter.json'), V1_CONFIG)
    writeJson(join(dir, 'settings', 'magic', v1SettingFileName('short1234', '法术体系')), {
      id: 'short1234', // 历史前缀 id（非 UUID）
      title: '法术体系',
      category: 'magic',
      content: '体系',
      order: 0,
      tags: [],
      createdAt: '2025-05-01T00:00:00.000Z',
      updatedAt: '2025-05-01T00:00:00.000Z'
    })
    writeJson(join(dir, 'settings', 'magic', v1SettingFileName(UUID_SEN, '火球术')), {
      id: UUID_SEN,
      title: '火球术',
      category: 'magic',
      content: '一发入魂',
      parentId: 'short1234', // 指向前缀 id：必须经 old→new 映射 remap
      order: 1,
      tags: [],
      createdAt: '2025-05-02T00:00:00.000Z',
      updatedAt: '2025-05-02T00:00:00.000Z'
    })
    report = migrateBook(dir)
  })

  it('非 UUID id 重建为 UUID 新文件名并记 warning', () => {
    const files = readdirSync(join(worldDir(dir), 'magic'))
    expect(files).toHaveLength(2)
    expect(existsSync(join(worldDir(dir), 'magic', 'short1234.yaml'))).toBe(false)
    expect(report.warnings.some((w) => w.includes('设定 id 重建') && w.includes('法术体系'))).toBe(true)
    for (const f of files) {
      expect(UUID_PATTERN.test(f.replace(/\.yaml$/, ''))).toBe(true)
    }
  })

  it('子设定 parentId 经 old→new 映射指向父设定新 id', () => {
    const child = readYamlFile<WorldEntryV2>(worldEntryFile(dir, 'magic', UUID_SEN))
    const parent = readYamlFile<WorldEntryV2>(
      join(
        worldDir(dir),
        'magic',
        readdirSync(join(worldDir(dir), 'magic')).find((f) => f !== `${UUID_SEN}.yaml`) as string
      )
    )

    expect(UUID_PATTERN.test(parent.id)).toBe(true)
    expect(child.parentId).toBe(parent.id)
    expect(validateMigration(dir)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 失败保护路径
// ---------------------------------------------------------------------------

describe('migrateBook — 失败保护', () => {
  it('v1 根配置损坏：抛 CORRUPT_BOOK，不产 book.json、不改名标记', () => {
    const dir = mkTmpBook()
    writeFileSync(join(dir, '.novelwriter.json'), 'not json {{{', 'utf8')

    expect(() => migrateBook(dir)).toThrow('CORRUPT_BOOK')
    expect(existsSync(bookJsonPath(dir))).toBe(false)
    expect(existsSync(join(dir, '.novelwriter.json'))).toBe(true)
    expect(existsSync(join(dir, '.novelwriter.json.migrated'))).toBe(false)
  })

  it('备份复制失败：抛错且书目录原样未动', () => {
    const dir = mkTmpBook()
    makeV1BookSimple(dir)
    // 用同名文件占住 backupRoot 位置 → cpSync 建目录必失败
    writeFileSync(backupRoot(dir), '我不是目录', 'utf8')

    expect(() => migrateBook(dir)).toThrow()
    expect(existsSync(bookJsonPath(dir))).toBe(false)
    expect(existsSync(join(dir, '.novelwriter.json'))).toBe(true)
    expect(readFileSync(join(dir, 'chapters', '001-黎明.md'), 'utf8')).toBe(CH1_RAW)
    expect(existsSync(foreshadowFile(dir))).toBe(false)
  })

  it('既无 book.json 也无 v1 标记：抛 CORRUPT_BOOK（拒绝对非书目录动手术）', () => {
    expect(() => migrateBook(mkTmpBook())).toThrow('CORRUPT_BOOK')
  })

  it('半迁移救援：book.json 缺失但 .migrated 在 → 可完成迁移，不重复改名', () => {
    const dir = mkTmpBook()
    makeV1BookSimple(dir)
    // 模拟上次迁移在写 book.json 前中断：标记已改名
    writeFileSync(
      join(dir, '.novelwriter.json.migrated'),
      readFileSync(join(dir, '.novelwriter.json'), 'utf8')
    )
    unlinkSync(join(dir, '.novelwriter.json'))

    const report = migrateBook(dir)

    expect(detectFormat(dir)).toBe('v2')
    expect(existsSync(join(dir, '.novelwriter.json.migrated'))).toBe(true)
    expect(readYamlFile<BookMeta>(bookJsonPath(dir)).name).toBe('星海拾荒者')
    expect(report.warnings).toEqual([])
  })
})

function makeV1BookSimple(dir: string): void {
  writeJson(join(dir, '.novelwriter.json'), V1_CONFIG)
  mkdirSync(join(dir, 'chapters'), { recursive: true })
  writeFileSync(join(dir, 'chapters', '001-黎明.md'), CH1_RAW, 'utf8')
}

// ---------------------------------------------------------------------------
// createBookSkeleton（project:create 的 v2 骨架，bookStore 单一入口）
// ---------------------------------------------------------------------------

describe('createBookSkeleton — project:create v2 骨架', () => {
  it('建 book.json(v2) + chapters/volumes/characters/world 目录 + 空台账，不再写 .novelwriter.json', () => {
    const dir = mkTmpBook()

    const meta = createBookSkeleton(dir, '新书', 'essay')

    expect(UUID_PATTERN.test(meta.id)).toBe(true)
    expect(readYamlFile<BookMeta>(bookJsonPath(dir))).toEqual(meta)
    expect(validateBookMeta(meta)).toEqual([])
    expect(meta.formatVersion).toBe(2)
    expect(meta.synopsis).toBe('')
    for (const d of [chaptersDir(dir), volumesDir(dir), charactersDir(dir), worldDir(dir)]) {
      expect(existsSync(d)).toBe(true)
    }
    expect(readYamlFile<ForeshadowLedger>(foreshadowFile(dir))).toEqual({ entries: [] })
    expect(existsSync(join(dir, '.novelwriter.json'))).toBe(false)
    expect(detectFormat(dir)).toBe('v2')
    expect(validateMigration(dir)).toEqual([])
  })
})
