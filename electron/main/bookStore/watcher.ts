// 书目录文件监听（Task 9）：fs.watch recursive + 300ms debounce + 分域缓存失效 + book:changed 广播。
// 设计契约（控制器裁定 2/3）：
// - 单活动项目：startWatching 先停前一个监听（stopWatching 含五域缓存全清——重开书永不见陈旧缓存）；
//   project:open 不同路径天然经由 stop-previous 切换；open 的接线在迁移+自检完成之后（裁定 8），
//   迁移的大规模文件改写绝不进 watcher 事件；
// - 事件过滤：basename 命中 /\.tmp-/（docStore 原子写的同级 tmp 残留）或 domainOf(relPath) 为 null
//   （book.json 配置、.migration-backup/ 迁移备份、未知散落路径）一律忽略——既不失效缓存也不发事件；
//   relPath 一律归一为正斜杠（Windows recursive watch 上报反斜杠）；
// - debounce：300ms 窗口内的变更路径合并为一次 book:changed（{paths: 升序去重的相对路径}）；
//   发送前先按触及域逐一 invalidateCache——先失效后广播的顺序是契约（渲染层重拉必须落在已失效的缓存上）；
// - 错误重试：watcher 'error'（EPERM/盘断开等）→ 1s 退避重启至多 3 次，仍败则 console.error 放弃——
//   应用绝不因 watcher 崩溃；放弃后的陈旧是可接受的（仓库 mutation 写后即同步缓存、点写路径直读磁盘，
//   点操作仍然正确；只是外部变更不再自动刷新）；
// - 自写回声（裁定 5 明文接受）：本应用自己的仓库写（原子 tmp+rename）也会触发事件——tmp 被过滤，
//   rename 目标文件的事件会失效「刚被 mutation 同步过」的缓存（无害：重读磁盘得到同样的字节）并发一次
//   book:changed（渲染层干净路径静默刷新 = 无操作）。不做写指纹抑制，接受这份噪音；
// - 窗口守卫：send 前查 webContents.isDestroyed()（窗口先于监听关闭时绝不向已销毁对象发送）。
import { watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import { domainOf, type BookDomain } from './paths'
import { invalidateCache as invalidateChapters } from './chapters'
import { invalidateCache as invalidateCharacters } from './characters'
import { invalidateCache as invalidateWorld } from './world'
import { invalidateCache as invalidateVolumes } from './volumes'
import { invalidateCache as invalidateNarrative } from './narrative'

/** 事件发送目标的最小窗口接口（BrowserWindow 结构满足；测试传 fake { webContents: { send } }）。 */
export interface WatcherWindow {
  webContents: {
    send(channel: string, payload: unknown): void
    isDestroyed?(): boolean
  }
}

const DEBOUNCE_MS = 300
const MAX_RESTARTS = 3
const RESTART_DELAY_MS = 1000
/** docStore 原子写的 `<name>.tmp-<uuid>` 残留事件——写入/rename 都会上报，全部忽略（裁定 2）。 */
const TMP_FILE_PATTERN = /\.tmp-/

/** 域 → 该域仓库的 invalidateCache（五个仓库各自导出同名函数，此处别名归并成表）。 */
const INVALIDATORS: Record<BookDomain, (p: string) => void> = {
  chapters: invalidateChapters,
  characters: invalidateCharacters,
  world: invalidateWorld,
  volumes: invalidateVolumes,
  narrative: invalidateNarrative
}

let handle: FSWatcher | null = null
let projectPath: string | null = null
let win: WatcherWindow | null = null
let pending: Set<string> = new Set()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
let restarts = 0

/** 开始监听书目录（单活动项目：先停前一个监听并清其缓存，再起新监听——裁定 2/8）。 */
export function startWatching(p: string, w: WatcherWindow): void {
  stopWatching()
  projectPath = p
  win = w
  restarts = 0
  openWatcher()
}

/**
 * 停止监听：关句柄、清 pending debounce 与重启定时器，并把当前书的五域缓存全部失效——
 * 重开（或重开另一本）永远不见陈旧缓存条目（裁定 2）。未监听时调用为无害 no-op。
 */
export function stopWatching(): void {
  closeHandle()
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (restartTimer !== null) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  pending = new Set()
  const p = projectPath
  projectPath = null
  win = null
  restarts = 0
  if (p !== null) {
    for (const invalidate of Object.values(INVALIDATORS)) invalidate(p)
  }
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function openWatcher(): void {
  if (projectPath === null || win === null) return // 已被 stop：不再起新句柄
  try {
    handle = watch(projectPath, { recursive: true }, onFsEvent)
    handle.on('error', (err: unknown) => {
      console.error(`[watcher] 文件监听错误（${projectPath}）:`, err)
      closeHandle()
      scheduleRestart()
    })
  } catch (err) {
    // fs.watch 同步抛（目录被删/句柄配额等）：同走重启预算——主进程绝不因监听崩溃
    console.error(`[watcher] 文件监听创建失败（${projectPath}）:`, err)
    scheduleRestart()
  }
}

function closeHandle(): void {
  if (handle !== null) {
    try {
      handle.close()
    } catch {
      // 句柄已死（底层资源消失）：close 抛错无碍，置空即可
    }
    handle = null
  }
}

function scheduleRestart(): void {
  if (restartTimer !== null || projectPath === null) return
  if (restarts >= MAX_RESTARTS) {
    console.error(
      `[watcher] 重启 ${MAX_RESTARTS} 次仍失败，放弃监听: ${projectPath} — ` +
        '书目录外部变更将不再自动刷新（缓存可能陈旧；仓库写后即同步、点写直读磁盘，点操作仍正确）'
    )
    return
  }
  restarts += 1
  restartTimer = setTimeout(() => {
    restartTimer = null
    openWatcher()
  }, RESTART_DELAY_MS)
}

function onFsEvent(_eventType: string, filename: string | Buffer | null): void {
  if (filename === null || projectPath === null) return
  const rel = (typeof filename === 'string' ? filename : filename.toString()).replace(/\\/g, '/')
  if (rel === '') return
  if (TMP_FILE_PATTERN.test(basename(rel))) return // 原子写残留：忽略（裁定 2）
  if (domainOf(rel) === null) return // book.json / .migration-backup / 未知路径：忽略（裁定 2/3）
  pending.add(rel)
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushPending, DEBOUNCE_MS)
}

function flushPending(): void {
  flushTimer = null
  const paths = pending
  pending = new Set()
  if (paths.size === 0 || projectPath === null) return
  // 先按触及域失效缓存、后广播（顺序即契约：渲染层收到事件后的重拉必须落在已失效的缓存上）
  const domains = new Set<BookDomain>()
  for (const rel of paths) {
    const domain = domainOf(rel)
    if (domain !== null) domains.add(domain) // 入口已过滤 null，此处防御性再判
  }
  for (const domain of domains) INVALIDATORS[domain](projectPath)
  const target = win
  if (target !== null && target.webContents.isDestroyed?.() !== true) {
    target.webContents.send('book:changed', { paths: [...paths].sort() }) // 一次事件带去重全集（裁定 2）
  }
}
