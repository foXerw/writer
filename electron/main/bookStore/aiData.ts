// `.ai/` 派生数据只读快照（M4b Task 4 裁定 4）：book:readAiData 通道的仓库层。
// organize 上下文装配（渲染层 useOrganize → assembleAiContext）需要章摘要/卷梗概/实体索引
// 三类原料——它们由 adopt 引擎（T3）与 M4c 摘要写入产出，读侧刻意与写侧解耦成这个纯读模块：
// - 零校验、零缓存、零副作用（不 noteSelfWrite、不失效任何域）：读一次盘上的此刻真相；
// - 缺目录/缺文件 → 空对象（上下文层自然缺席，assembleAiContext 对空值全容错）；
// - 坏文件 → console.warn（绝对路径，镜像 listProposals 纪律）+ 跳过该条，绝不整体抛——
//   一本坏摘要不该瘫痪「整理本章」按钮；
// - 键权威 = 文件内 chapterId/volumeId 字段（裁定 4「keyed by chapterId from file」），
//   字段缺失/非字符串时兜底用文件名 stem（写侧布局 = `<id>.yaml`，两者常态一致）；
// - index.json 是真 JSON 字节（adopt.mergeIndex 产出 Record<entityId, chapterId[]>），
//   非 string[] 的键值逐个 warn + 跳过（其余保留），顶层非对象 → warn + {}；
// - meta（Task 6 P1）= book.json 的 {name, synopsis} 投影——organize 上下文大纲层的原料
//   （useOrganize 把 synopsis 接进 ContextInputs.outlineNotes）。book.json 是 JSON 字节
//   （JSON ⊂ YAML），读取沿用 docStore.readYamlFile（与 format.ts/project.ts 同款口径）；
//   缺档/坏档/字段非字符串 → 空串兜底（坏档 warn，缺档静默——新书常态），绝不整体抛。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiDataSnapshot } from '../../../src/common/ipc'
import { aiIndexFile, bookJsonPath, chapterSummariesDir, volumeSummariesDir } from './paths'
import { listYamlFiles, readYamlFile } from './docStore'

const YAML_EXT = '.yaml'

/** 摘要目录 → Record<实体 id, text>：单档损坏 warn+skip；text 非字符串视为坏条目 skip。 */
function readSummaries(dir: string, idField: 'chapterId' | 'volumeId'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of listYamlFiles(dir)) {
    const abs = join(dir, name)
    let doc: unknown
    try {
      doc = readYamlFile<unknown>(abs)
    } catch (err) {
      console.warn(
        `跳过损坏摘要文件: ${abs}: ${err instanceof Error ? err.message : String(err)}`
      )
      continue
    }
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      console.warn(`跳过非对象摘要文件: ${abs}`)
      continue
    }
    const record = doc as Record<string, unknown>
    if (typeof record.text !== 'string') {
      console.warn(`跳过无 text 字段的摘要文件: ${abs}`)
      continue
    }
    const key =
      typeof record[idField] === 'string' && record[idField] !== ''
        ? (record[idField] as string)
        : name.slice(0, -YAML_EXT.length)
    out[key] = record.text
  }
  return out
}

/** `.ai/index.json` → Record<entityId, chapterId[]>：缺 → {}；坏 JSON/顶层非对象 → warn+{}；非 string[] 键值 → warn+skip。 */
function readEntityIndex(p: string): Record<string, string[]> {
  const abs = aiIndexFile(p)
  if (!existsSync(abs)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    console.warn(
      `.ai/index.json 损坏，按空索引读取: ${abs}: ${err instanceof Error ? err.message : String(err)}`
    )
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn(`.ai/index.json 顶层非对象，按空索引读取: ${abs}`)
    return {}
  }
  const out: Record<string, string[]> = {}
  for (const [entityId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
      out[entityId] = value as string[]
    } else {
      console.warn(`跳过 .ai/index.json 非法值（该键按缺席处理）: ${abs}: ${entityId}`)
    }
  }
  return out
}

/** book.json → {name, synopsis}：缺档静默空串；坏档 warn + 空串；字段缺失/非字符串 → 该字段空串。 */
function readBookMeta(p: string): AiDataSnapshot['meta'] {
  const empty = { name: '', synopsis: '' }
  const abs = bookJsonPath(p)
  if (!existsSync(abs)) return empty
  let doc: unknown
  try {
    doc = readYamlFile<unknown>(abs)
  } catch (err) {
    console.warn(
      `跳过损坏 book.json（书目注记按空读取）: ${abs}: ${err instanceof Error ? err.message : String(err)}`
    )
    return empty
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    console.warn(`跳过非对象 book.json（书目注记按空读取）: ${abs}`)
    return empty
  }
  const record = doc as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : '',
    synopsis: typeof record.synopsis === 'string' ? record.synopsis : ''
  }
}

/** 一次读齐 organize 上下文的 `.ai/` 三域原料 + 书目注记（通道 book:readAiData 的唯一委托目标）。 */
export function readAiData(p: string): AiDataSnapshot {
  return {
    chapterSummaries: readSummaries(chapterSummariesDir(p), 'chapterId'),
    volumeSummaries: readSummaries(volumeSummariesDir(p), 'volumeId'),
    entityIndex: readEntityIndex(p),
    meta: readBookMeta(p)
  }
}
