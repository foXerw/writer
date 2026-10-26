// 书目录 YAML 文档读写的唯一入口（原子写：同级 tmp + rename，见 M2 计划原子性契约）。
// 主进程代码：一律相对导入 + node: 前缀内置模块。
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import yaml from 'js-yaml'

/**
 * 读并解析一个 YAML（含 .json 后缀但按 YAML 超集解析的 book.json）文档。
 * 文件不存在：抛 `ENOBOOK: <absPath>`（下游按该前缀识别缺档）。
 * 内容损坏：透传 js-yaml 的 YAMLException（由调用方决定语义，如 detectFormat 包装为 CORRUPT_BOOK）。
 */
export function readYamlFile<T>(absPath: string): T {
  if (!existsSync(absPath)) {
    throw new Error(`ENOBOOK: ${absPath}`)
  }
  return yaml.load(readFileSync(absPath, 'utf8')) as T
}

// ---------------------------------------------------------------------------
// Task 9 修订轮2（I1）：自写抑制登记簿
// ---------------------------------------------------------------------------
// 本应用自己的写盘/删档在此登记 path→time；watcher 在 ~1s 窗口内把这些路径从 book:changed
// 广播集中剔除（缓存失效照常执行，保持 cache==磁盘真相）——确定性自回声（rename 的 H1 同步、
// deleteVolume 的疏散章写循环等）从源头静音，不再依赖渲染层内容比对兜底；内容比对保留，
// 继续兜真正的并发外部编辑。窗口内的真外部改动会被一并抑制（接受的代价，控制器选定机制）。
const SELF_WRITE_CAP = 200
const SELF_WRITE_WINDOW_MS = 1000
/** 正斜杠归一的绝对路径 → Date.now()（插入序即时序，容量满淘汰最旧）。 */
const selfWrites = new Map<string, number>()

function selfWriteKey(absPath: string): string {
  return absPath.replace(/\\/g, '/')
}

/** 登记一次自写/自删（仓库 mutation 与两个原子写入口调用；watcher 广播过滤消费）。 */
export function noteSelfWrite(absPath: string): void {
  const key = selfWriteKey(absPath)
  selfWrites.delete(key) // 重插到尾部，维持插入序 = 时间序
  selfWrites.set(key, Date.now())
  while (selfWrites.size > SELF_WRITE_CAP) {
    const oldest = selfWrites.keys().next()
    if (oldest.done === true) break
    selfWrites.delete(oldest.value)
  }
}

/** 该绝对路径在抑制窗口内是否有过自写/自删（watcher flush 时逐路径查询）。 */
export function isRecentSelfWrite(absPath: string): boolean {
  const ts = selfWrites.get(selfWriteKey(absPath))
  return ts !== undefined && Date.now() - ts <= SELF_WRITE_WINDOW_MS
}

/**
 * 原子写：mkdir -p 父目录 → 写同级 `<basename>.tmp-<uuid>` → renameSync 覆盖目标。
 * 任何失败（序列化/写盘/rename）都会移除残留 tmp 并原样抛出；成功后目录里不留 `.tmp-` 文件。
 */
export function writeYamlFileAtomic(absPath: string, obj: unknown): void {
  const dir = dirname(absPath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `${basename(absPath)}.tmp-${randomUUID()}`)
  try {
    writeFileSync(tmpPath, yaml.dump(obj, { noRefs: true, lineWidth: 120 }), 'utf8')
    renameSync(tmpPath, absPath)
    noteSelfWrite(absPath) // I1：全部仓库写盘的唯一咽喉，登记即全覆盖
  } finally {
    rmSync(tmpPath, { force: true })
  }
}

/**
 * 原始文本的原子写（章节 .md 等不经 YAML 序列化的书文件）：
 * 与 writeYamlFileAtomic 同一纪律——mkdir -p 父目录 → 同级 `<basename>.tmp-<uuid>` → renameSync 覆盖。
 * 文本字节级原样落盘（front-matter/空行/emoji 零转义）。
 */
export function writeTextFileAtomic(absPath: string, text: string): void {
  const dir = dirname(absPath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `${basename(absPath)}.tmp-${randomUUID()}`)
  try {
    writeFileSync(tmpPath, text, 'utf8')
    renameSync(tmpPath, absPath)
    noteSelfWrite(absPath) // I1：章节 .md 写盘的咽喉，登记即全覆盖
  } finally {
    rmSync(tmpPath, { force: true })
  }
}

/** 列出目录下的 *.yaml 文件名（不含子目录/其他后缀）；目录不存在返回 []；升序排序保证迭代稳定。 */
export function listYamlFiles(dirAbs: string): string[] {
  if (!existsSync(dirAbs)) return []
  return readdirSync(dirAbs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name)
    .sort()
}
