// M2 Task 10（端到端收口主心骨）：v1 样本书 → migrateBook → v2 五域仓库全链路读取 →
// validateMigration [] → detectFormat v2 → 二次迁移门（幂等，备份不复制）。
// 再加两条跨任务接缝钉死：
// ①A-seam（最近列表点击路径）：Home handleOpenProject → navigate 只带 projectPath，渲染层必须经
//    project:open 补开一次——本文件直接调用「Workspace 将调用的同一个函数」（注册后的 project:open
//    handler，electron 以最小替身 mock，仿 project.test.ts；BrowserWindow.fromWebContents 返回带
//    webContents.send 间谍 + isDestroyed 的真实形状替身窗口），钉死 v1 书经该路径得到
//    {config from book.json, migration{backupPath,warnings}} 且 watcher 真的在跑（经由可观察的
//    book:changed 广播断言——外部新建 chapters/ 文件 → 收到对应路径事件，startWatching 唯一产出即此，
//    比 spy 内部函数更接近「这条路径整活」的证明）。
// ②R1-resume（崩溃中断续传）：book.json + .novelwriter.json（未改名）并存 = migrateBook 最后一步
//    （标记 rename）前崩溃的唯一无歧义中断态 → project:open 必须自动续传（Task 3.5 resume 语义此前
//    仅直调可达）；配合 R2（同 id 角色 json 绝不覆盖既有 yaml），完成态 validateMigration []、残留清零。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import { listChapters } from './chapters'
import { listCharacters } from './characters'
import { listWorldEntries } from './world'
import { listVolumes } from './volumes'
import { detectFormat } from './format'
import { migrateBook, validateMigration } from './migrate'
import { stopWatching } from './watcher'
import { bookJsonPath, characterFile } from './paths'
import { readYamlFile } from './docStore'
import type { BookMeta } from '../../../src/common/schema'
import type { MigrationReport, ProjectData } from '../../../src/common/ipc'

// ---------------------------------------------------------------------------
// electron 最小替身（仅 project.ts 需要；watcher 不 mock——A-seam 要求真实 fs.watch 活体）
// ---------------------------------------------------------------------------
type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
)
const fakeWin = vi.hoisted(() => ({
  webContents: { send: vi.fn(), isDestroyed: () => false }
}))
const fakeEvent = { sender: {} }

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown>
    ): void => {
      handlers.set(channel, listener)
    }
  },
  BrowserWindow: {
    fromWebContents: (): unknown => fakeWin
  }
}))

import { registerProjectHandlers } from '../ipc/modules/project'

beforeAll(() => {
  registerProjectHandlers()
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fakeWin.webContents.send.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  // 真实 watcher 不在测试间游荡（stopWatching 幂等，未监听时 no-op）
  stopWatching()
})

function getHandler(channel: string): Handler {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn as Handler
}

/** 轮询等待条件成立（watcher 300ms debounce + fs 事件投递有延迟；5s 上限防挂死）。 */
async function waitUntil(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitUntil 超时')
    await new Promise((r) => setTimeout(r, 25))
  }
}

// ---------------------------------------------------------------------------
// v1 样本书夹具（全部实体 id 用合法 UUID，迁移平移后 validateCharacterV2/WorldEntryV2 须 []）
// ---------------------------------------------------------------------------
const CHAR_JIA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // 沈砚
const CHAR_MING_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // 阿明（双生子 #1）
const CHAR_MING_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // 阿明（双生子 #2）
const WORLD_CITY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' // 雾城（location，子条目 parentId 指向它）
const WORLD_HIST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' // 建城史（history，parentId = 雾城）

const V1_MARKER_JSON = JSON.stringify({
  name: '旧日的城',
  type: 'novel',
  version: '1.0.0',
  settings: { wordCountGoal: 0, dailyGoal: 3000, autoSave: false, autoSaveInterval: 45000 }
})

/** 造一本最小但覆盖全部接缝的 v1 书：2 章（含 CRLF）、3 角色（双生子+characterId 可解边+幽灵丢弃边）、2 设定（parentId 层级）。 */
function makeV1Book(dir: string): void {
  writeFileSync(join(dir, '.novelwriter.json'), V1_MARKER_JSON, 'utf8')
  mkdirSync(join(dir, 'chapters'), { recursive: true })
  writeFileSync(join(dir, 'chapters', '001-起点.md'), '# 起点\n\n正文A：雾城苏醒。\n', 'utf8')
  // CRLF 夹具（T3.5 Minor2）：迁移正文逐字节原样
  writeFileSync(join(dir, 'chapters', '002-转折.md'), '# 转折\r\n\r\n正文B：钟楼倒塌。\r\n续行。\r\n', 'utf8')

  mkdirSync(join(dir, 'characters'), { recursive: true })
  writeFileSync(
    join(dir, 'characters', `${CHAR_JIA}.json`),
    JSON.stringify({
      id: CHAR_JIA,
      name: '沈砚',
      gender: 'male',
      age: 24,
      role: 'protagonist',
      appearance: '青衫束发',
      personality: '沉稳',
      background: '雾城钟匠',
      // 双生子「阿明」使名字歧义，但 characterId 直指 #1——T3.5(c) 救援路径
      relationships: [
        { characterName: '阿明', characterId: CHAR_MING_1, relationship: '义兄', description: '总角之交' }
      ],
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }),
    'utf8'
  )
  writeFileSync(
    join(dir, 'characters', `${CHAR_MING_1}.json`),
    JSON.stringify({
      id: CHAR_MING_1,
      name: '阿明',
      gender: 'male',
      age: 30,
      role: 'supporting',
      appearance: '高瘦',
      personality: '豪爽',
      background: '渡口船工',
      // 唯一同名匹配救援路径
      relationships: [{ characterName: '沈砚', relationship: '好友' }],
      tags: [],
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-02T00:00:01.000Z'
    }),
    'utf8'
  )
  writeFileSync(
    join(dir, 'characters', `${CHAR_MING_2}.json`),
    JSON.stringify({
      id: CHAR_MING_2,
      name: '阿明',
      gender: 'female',
      age: 28,
      role: 'minor',
      appearance: '矮小',
      personality: '机敏',
      background: 'market 商贩',
      // 幻影目标：名字无匹配且无 characterId → 丢弃 + warning（v1→v2 边数期望因此 = 2）
      relationships: [{ characterName: '无名者', relationship: '旧识' }],
      tags: [],
      createdAt: '2026-01-01T00:00:02.000Z',
      updatedAt: '2026-01-02T00:00:02.000Z'
    }),
    'utf8'
  )

  mkdirSync(join(dir, 'settings', 'location'), { recursive: true })
  mkdirSync(join(dir, 'settings', 'history'), { recursive: true })
  writeFileSync(
    join(dir, 'settings', 'location', `${WORLD_CITY}.json`),
    JSON.stringify({
      id: WORLD_CITY,
      title: '雾城',
      category: 'location',
      content: '终年大雾，钟楼为眼。',
      parentId: null,
      order: 1,
      tags: ['城'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }),
    'utf8'
  )
  writeFileSync(
    join(dir, 'settings', 'history', `${WORLD_HIST}.json`),
    JSON.stringify({
      id: WORLD_HIST,
      title: '建城史',
      category: 'history',
      content: '筑城于雾眼之畔。',
      parentId: WORLD_CITY,
      order: 2,
      tags: [],
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-02T00:00:01.000Z'
    }),
    'utf8'
  )
}

// ---------------------------------------------------------------------------
// ①迁移 → v2 全链路读取 → 自检 → 幂等门
// ---------------------------------------------------------------------------
describe('e2e：v1 样本书一键迁移后，v2 仓库全链路读取与 v1 输入一致', () => {
  it('计数/标题/边数/层级全对齐；validateMigration []；detectFormat v2；二次迁移被门拒且备份不复制', () => {
    const dir = mkTmpBook()
    makeV1Book(dir)

    const report = migrateBook(dir)
    expect(existsSync(report.backupPath)).toBe(true)
    expect(report.warnings).toContain('关系丢弃: 阿明→无名者')

    // --- 章节（v1 期望：2 章，标题取首个顶格 `# ` 行，order 取编号 1/2）---
    const chapters = listChapters(dir)
    expect(chapters.map((c) => c.title)).toEqual(['起点', '转折'])
    expect(chapters.map((c) => c.order)).toEqual([1, 2])
    expect(chapters.every((c) => c.volumeId === null && c.status === 'draft')).toBe(true)
    expect(chapters[0].content).toContain('正文A')
    // CRLF 逐字节原样保留（T3.5 Minor2 夹具）
    expect(chapters[1].content).toContain('正文B：钟楼倒塌。\r\n续行。\r\n')
    expect(existsSync(join(dir, 'chapters', '001-起点.md'))).toBe(false)
    expect(existsSync(join(dir, 'chapters', '002-转折.md'))).toBe(false)

    // --- 角色（v1 期望：3 卡、2 条边：沈砚→阿明#1（id 直解）、阿明#1→沈砚（唯一名）、幽灵边丢弃）---
    const characters = listCharacters(dir)
    expect(characters).toHaveLength(3)
    const byId = new Map(characters.map((c) => [c.id, c]))
    expect(byId.get(CHAR_JIA)?.name).toBe('沈砚')
    expect(byId.get(CHAR_MING_2)?.name).toBe('阿明')
    expect(byId.get(CHAR_JIA)?.relationships).toEqual([
      { targetId: CHAR_MING_1, kind: '义兄', note: '总角之交' }
    ])
    expect(byId.get(CHAR_MING_1)?.relationships).toEqual([{ targetId: CHAR_JIA, kind: '好友' }])
    expect(byId.get(CHAR_MING_2)?.relationships).toEqual([])
    expect(characters.reduce((n, c) => n + c.relationships.length, 0)).toBe(2)

    // --- 世界观（v1 期望：2 条，parentId 层级经 old→new 映射保留）---
    const world = listWorldEntries(dir)
    expect(world).toHaveLength(2)
    const city = world.find((w) => w.title === '雾城')
    const hist = world.find((w) => w.title === '建城史')
    expect(city).toBeDefined()
    expect(hist?.parentId).toBe(WORLD_CITY)
    expect(existsSync(join(dir, 'world', 'location', `${WORLD_CITY}.yaml`))).toBe(true)
    expect(existsSync(join(dir, 'world', 'history', `${WORLD_HIST}.yaml`))).toBe(true)
    expect(existsSync(join(dir, 'settings'))).toBe(false) // 全迁完的空目录被剪除

    // --- 卷（v1 无卷概念，期望 0；伏笔台账为空）---
    expect(listVolumes(dir)).toHaveLength(0)
    expect(readYamlFile<{ entries: unknown[] }>(join(dir, 'foreshadow.yaml')).entries).toEqual([])

    // --- 自检与格式 ---
    expect(validateMigration(dir)).toEqual([])
    expect(detectFormat(dir)).toBe('v2')

    // --- 幂等门（模拟二次 open 的 detectFormat 门后不会再调 migrateBook；直调双保险拒绝）---
    const backupCountBefore = readdirSync(join(dir, '.migration-backup')).length
    expect(() => migrateBook(dir)).toThrow(/ALREADY_MIGRATED/)
    expect(readdirSync(join(dir, '.migration-backup'))).toHaveLength(backupCountBefore)
  })
})

// ---------------------------------------------------------------------------
// ②A-seam：最近列表点击 = 与对话框 open 同一条 project:open 函数（迁移+config+watcher 全生效）
// ---------------------------------------------------------------------------
describe('e2e：A-seam——project:open handler（Workspace 路径直达挂载将调用的同一函数）', () => {
  it('v1 书经该路径返回 config+migration 且 watcher 活体（book:changed 可观察）', async () => {
    const dir = mkTmpBook()
    makeV1Book(dir)

    const data = (await getHandler('project:open')(fakeEvent, dir)) as ProjectData
    expect(data.name).toBe('旧日的城')
    // config 从 v1 .novelwriter.json settings 平移（最近点击路径此前完全丢配置——A-seam 后果之一）
    expect(data.config).toEqual({
      wordCountGoal: 0,
      dailyGoal: 3000,
      autoSave: false,
      autoSaveInterval: 45000
    })
    const report = data.migration as MigrationReport
    expect(report).not.toBeNull()
    expect(existsSync(report.backupPath)).toBe(true)
    expect(report.warnings).toContain('关系丢弃: 阿明→无名者')

    // watcher 活体证明：迁移期间不监听（裁定 8），open 返回后外部新建章节文件必须广播 book:changed。
    // 选「迁移没碰过的新路径」写盘，避开 docStore 自写抑制的 ~1s 窗口（迁移刚写完同路径文件）。
    writeFileSync(join(dir, 'chapters', 'ffff0000-0000-4000-8000-000000000000.md'), '# 外\n', 'utf8')
    await waitUntil(() =>
      fakeWin.webContents.send.mock.calls.some(
        ([ch, payload]) =>
          ch === 'book:changed' &&
          (payload as { paths: string[] }).paths.some((p) =>
            p.includes('ffff0000-0000-4000-8000-000000000000')
          )
      )
    )
  })

  it('v2 书重复 open 不重迁：migration:null、id 稳定、备份不复制', async () => {
    const dir = mkTmpBook()
    makeV1Book(dir)
    const first = (await getHandler('project:open')(fakeEvent, dir)) as ProjectData
    const backupCount = readdirSync(join(dir, '.migration-backup')).length

    stopWatching() // 防上一段 watcher 回声干扰断言
    const second = (await getHandler('project:open')(fakeEvent, dir)) as ProjectData
    expect(second.migration).toBeNull()
    expect(second.id).toBe(first.id)
    expect(readdirSync(join(dir, '.migration-backup'))).toHaveLength(backupCount)
  })
})

// ---------------------------------------------------------------------------
// ③R1+R2：崩溃中断续传经 project:open 可达，且不覆盖较新 yaml
// ---------------------------------------------------------------------------
describe('e2e：R1——book.json+.novelwriter.json 并存（标记未改名的崩溃态）经 open 自动续传', () => {
  it('续传补完：报告并入 ProjectData.migration；R2 同 id yaml 不被覆盖；残留清零 validateMigration []', async () => {
    const dir = mkTmpBook()
    makeV1Book(dir)
    const first = migrateBook(dir) // 完整迁移（产生 .migrated 改名 + 备份）

    // 伪造崩溃态：从备份恢复一个 v1 角色 json + 重建未改名的 .novelwriter.json
    // （= migrateBook 最后一步 rename 前崩溃；备份里另有全部 v1 原件）
    const bookIdBefore = readYamlFile<BookMeta>(bookJsonPath(dir)).id
    const yamlBefore = readFileSync(characterFile(dir, CHAR_JIA), 'utf8')
    copyFileSync(join(first.backupPath, 'characters', `${CHAR_JIA}.json`), join(dir, 'characters', `${CHAR_JIA}.json`))
    copyFileSync(join(first.backupPath, '.novelwriter.json'), join(dir, '.novelwriter.json'))

    const data = (await getHandler('project:open')(fakeEvent, dir)) as ProjectData
    // R1 接线：崩溃态的续传报告必须出现在 ProjectData.migration（此前 resume 仅直调可达）
    const report = data.migration as MigrationReport
    expect(report).not.toBeNull()
    // R2：同 id 的 v1 json 绝不覆盖已存在（可能更新）的 yaml，只跳过+清残留
    expect(report.warnings).toContain(`跳过已存在: ${CHAR_JIA}`)
    expect(report.backupPath).toBe(first.backupPath) // 续传复用崩溃 run 的原始备份，不产生第二份
    expect(readFileSync(characterFile(dir, CHAR_JIA), 'utf8')).toBe(yamlBefore)
    expect(readYamlFile<BookMeta>(bookJsonPath(dir)).id).toBe(bookIdBefore)

    // 残留全清 + 自检通过 + 标记补改名
    expect(existsSync(join(dir, 'characters', `${CHAR_JIA}.json`))).toBe(false)
    expect(existsSync(join(dir, '.novelwriter.json'))).toBe(false)
    expect(existsSync(join(dir, '.novelwriter.json.migrated'))).toBe(true)
    expect(validateMigration(dir)).toEqual([])
    expect(readdirSync(join(dir, '.migration-backup')).length).toBe(1)

    // 续传完成后回到干净 v2：再 open 不再报告迁移
    stopWatching()
    const again = (await getHandler('project:open')(fakeEvent, dir)) as ProjectData
    expect(again.migration).toBeNull()
  })
})
