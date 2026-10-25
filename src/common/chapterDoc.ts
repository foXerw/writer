// 章节文档编解码（主/渲染进程共用）：`---\n<yaml of meta>\n---\n\n<body>`。
// 契约钉死（M2 计划 Task 3 / Review Focus 4）：
// - serialize 恒定产出 `---\n…\n---\n\n` 头部；body 原样拼接、零转义（正文里的 `---`/空行/emoji 全部无损）；
// - parse 只认文件起始的第一个分隔块：首行必须是 `---`，其后第一行恰为 `---` 的行是闭合定界；
//   闭合定界后接受 `\n\n` / `\n` / EOF（只归一化掉一个换行，body 自带的前导空行保留）；
// - meta 用 yaml.dump(lineWidth:120, noRefs:true)：含 `#`、`/`、emoji、换行的标题由 YAML 引号/缩进机制
//   保证 dump 出的 front-matter 块内不会出现顶格 `---` 行，闭合扫描不会被内容歧义命中；
// - 无 front-matter 抛 `FRONTMATTER_MISSING: <source>`；有块但 YAML 坏/meta 不合法抛 `FRONTMATTER_INVALID: <source>: …`。
// source 是调用方给的诊断标识（章节 id 或文件路径），仅用于错误串。
import yaml from 'js-yaml'
import type { ChapterDoc, ChapterMeta } from './schema'
import { validateChapterMeta } from './schema'

const DELIMITER = '---'

export function serializeChapterDoc(meta: ChapterMeta, body: string): string {
  // yaml.dump 输出自带结尾 \n，故拼上 `---\n\n` 即为标准头部
  return `${DELIMITER}\n${yaml.dump(meta, { lineWidth: 120, noRefs: true })}${DELIMITER}\n\n${body}`
}

export function parseChapterDoc(raw: string, source = 'unknown'): ChapterDoc {
  const lines = raw.split('\n')
  if (lines[0] !== DELIMITER) {
    throw new Error(`FRONTMATTER_MISSING: ${source}`)
  }
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === DELIMITER) {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    throw new Error(`FRONTMATTER_MISSING: ${source}`)
  }

  let loaded: unknown
  try {
    loaded = yaml.load(lines.slice(1, closeIdx).join('\n'))
  } catch {
    throw new Error(`FRONTMATTER_INVALID: ${source}: YAML 解析失败`)
  }
  const errors = validateChapterMeta(loaded)
  if (errors.length > 0) {
    throw new Error(`FRONTMATTER_INVALID: ${source}: ${errors.join('; ')}`)
  }

  // 闭合定界行的 \n 已由 split 吃掉；再归一化掉一个紧随的空行（`\n\n`/`\n`/EOF 三种收尾同义）
  let body = lines.slice(closeIdx + 1).join('\n')
  if (body.startsWith('\n')) {
    body = body.slice(1)
  }
  return { meta: loaded as ChapterMeta, body }
}
