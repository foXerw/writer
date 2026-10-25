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
