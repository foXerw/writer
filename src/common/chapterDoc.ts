// 章节文档编解码（主/渲染进程共用）：`---\n<yaml of meta>\n---\n\n<body>`。
// 契约钉死（M2 计划 Task 3 / Review Focus 4）：
// - serialize 恒定产出 `---\n…\n---\n\n` 头部；body 原样拼接、零转义（正文里的 `---`/空行/emoji 全部无损）；
// - parse 只认文件起始的第一个分隔块：首行必须是 `---`，其后第一行恰为 `---` 的行是闭合定界；
//   闭合定界后接受 `\n\n` / `\n` / `\r\n\r\n` / `\r\n` / EOF（只归一化掉紧随的一个换行序列，
//   body 自带的前导空行保留）；
// - 读侧宽容（FI-1，外部工具整本改写不致章节隐身）：剥一个前导 BOM；定界行去掉行尾 `\r` 后再比对
//   （即容忍 CRLF/BOM 读取）；body 字节一律原样保留（含内部 `\r\n`，那是用户内容）。写出仍恒为 LF。
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
  // BOM 剥离必须在一切判定之前（含空串/仅 BOM 文件），错误串的 source 标注保持不变
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const lines = text.split('\n')
  // CRLF 容忍：定界行去掉行尾 \r 再比对；正文与 body 之间/内部的字节绝不改写
  const isDelimiter = (line: string): boolean => line.replace(/\r$/, '') === DELIMITER
  if (!isDelimiter(lines[0])) {
    throw new Error(`FRONTMATTER_MISSING: ${source}`)
  }
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (isDelimiter(lines[i])) {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    throw new Error(`FRONTMATTER_MISSING: ${source}`)
  }

  let loaded: unknown
  try {
    // front-matter 是机器生成的元数据：逐行去掉行尾 \r 再喂 YAML（LF 输入下为恒等变换）
    loaded = yaml.load(
      lines
        .slice(1, closeIdx)
        .map((l) => l.replace(/\r$/, ''))
        .join('\n')
    )
  } catch {
    throw new Error(`FRONTMATTER_INVALID: ${source}: YAML 解析失败`)
  }
  const errors = validateChapterMeta(loaded)
  if (errors.length > 0) {
    throw new Error(`FRONTMATTER_INVALID: ${source}: ${errors.join('; ')}`)
  }

  // 闭合定界行尾部的换行符已由 split 的 `\n` 承担；只归一化掉紧随的一个换行序列
  // （`\n\n`/`\n`/EOF 与 CRLF 版 `\r\n\r\n`/`\r\n`/EOF 同义），body 其余字节原样保留
  let body = lines.slice(closeIdx + 1).join('\n')
  if (body.startsWith('\r\n')) {
    body = body.slice(2)
  } else if (body.startsWith('\n')) {
    body = body.slice(1)
  }
  return { meta: loaded as ChapterMeta, body }
}
