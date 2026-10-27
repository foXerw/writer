// 上下文装配器（M4a Task 5，纯函数、零 I/O、主/渲染共用）。
// spec §7.4 红线：任何请求都不得整本塞书——按优先级分层装配，从最低优先级整段丢弃直至入预算；
// 正文超预算 80% 时截断保尾（续写场景保近文）。非当前章正文与非涉事实体卡绝不进入输出。
//
// 优先级（高→低，越靠前越保留）：
//   system 骨架 > 当前章正文（user 消息，保底） > 涉事实体卡 > 最近 3 章摘要 > 当前卷梗概 > 全书大纲线
// 丢弃按逆序（大纲线最先），droppedFor 记录稳定 token：
//   'outline' | 'volume-summary' | 'chapter-summaries' | 'entity-cards'；
//   正文截断不是「丢弃」而是「部分保留」，单独记 'body-truncated'（按发生的先后顺序入列）。
//
// 序列化格式为确定性纯函数输出：卡池按 kind→id 排序、每卡 JSON.stringify 一行；
// 摘要按 order 升序；段间以 \n\n 分隔，段首为中文标题行（【…】）。M4b 组织管线为其首个消费者。

import type { AiMessage } from './ai-types'
import type { BookMeta, CharacterV2, VolumeDoc, WorldEntryV2 } from './schema'

// ---------------------------------------------------------------------------
// token 估算（轻量启发式：CJK 每字 1 + 其余每 4 字符 1，向上取整）
// ---------------------------------------------------------------------------

// CJK：扩展 A 区 U+3400–4DBF、基本区 U+4E00–9FFF、兼容表意区 U+F900–FAFF
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g

/**
 * 估算 token 数：CJK 每字记 1；其余字符（含空格/标点/换行）每 4 字符记 1，
 * 余数向上取整。对空格略高估——预算场景宁多勿少，可接受。
 * 例：'你好 Hello' = 2 + ceil(6/4) = 4。
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  const cjk = (text.match(CJK_RE) ?? []).length
  return cjk + Math.ceil((text.length - cjk) / 4)
}

// ---------------------------------------------------------------------------
// 输入/输出契约
// ---------------------------------------------------------------------------

/** 装配器视角的书目投影（非 schema 克隆：只要章目录/卷列表/大纲注记） */
export interface ContextBook {
  meta: BookMeta
  volumes: VolumeDoc[]
  outlineNotes: string
  chapters: { id: string; title: string; volumeId: string | null; order: number }[]
}

export interface ContextInputs {
  book: ContextBook
  currentChapterId: string
  /** 当前章正文（保底必含） */
  chapterBody: string
  /** 章 id → 摘要（.ai/summaries/chapters 已有者；缺项跳过） */
  chapterSummaries: Record<string, string>
  /** 卷 id → 卷梗概（已有者） */
  volumeSummaries: Record<string, string>
  /** 实体 id → 出场章 id 列表（M4b 维护；可为空对象 = 索引未建） */
  entityIndex: Record<string, string[]>
  /** 候选卡池（只有 entityIndex 命中当前章的卡片才会进入上下文） */
  entityCards: { character: CharacterV2[]; world: WorldEntryV2[] }
  budgetTokens: number
}

export interface AssembledContext {
  messages: AiMessage[]
  /** 因预算被整段丢弃的层 / 正文截断标记，按发生先后排列 */
  droppedFor: string[]
  /** 全部消息内容拼接后的估算 token（= estimateTokens(Σ content)，用于预算断言） */
  estTokens: number
}

// ---------------------------------------------------------------------------
// 固定骨架与段标题
// ---------------------------------------------------------------------------

export const ORGANIZE_SYSTEM_SKELETON = [
  '你是「完美小说」的设定管家，负责协助作者整理小说设定、梳理剧情脉络并保持全书一致性。',
  '工作原则：',
  '1. 只依据下方提供的上下文层作答，绝不臆造未给出的既有设定。',
  '2. 尊重既有正文与设定卡；发现冲突时以正文为准，并明确指出分歧所在。',
  '3. 使用简体中文回复，条理清晰，输出可直接被作者采纳。',
  '4. 上下文层因预算受限可能被省略，信息不足时如实说明，而不是猜测。'
].join('\n')

const USER_BODY_HEADER = '【当前章节正文】\n'
const BODY_TRUNCATION_MARKER = '…\n'

const ENTITY_HEADER = '【涉事实体卡】'
const CHAPTER_SUMMARY_HEADER = '【前三章摘要】'
const VOLUME_SUMMARY_HEADER = '【当前卷梗概】'
const OUTLINE_HEADER = '【全书大纲】'

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

interface Section {
  /** droppedFor 用的稳定 token */
  token: string
  /** 含段标题的完整段文本（段内不含首尾 \n\n） */
  text: string
}

/**
 * 取最长后缀使其满足 fits（estimateTokens 随长度单调不减 → 二分）。
 * 按码点（非 UTF-16 码元）切：边界绝不劈开代理对（emoji 等 astral 字符）。
 */
function longestTailToFit(text: string, fits: (tail: string) => boolean): string {
  const cps = Array.from(text)
  let lo = 0
  let hi = cps.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(cps.slice(cps.length - mid).join(''))) lo = mid
    else hi = mid - 1
  }
  return cps.slice(cps.length - lo).join('')
}

function buildSections(inp: ContextInputs): Section[] {
  const sections: Section[] = []
  const { book, currentChapterId } = inp

  // 1) 涉事实体卡：仅 entityIndex 命中当前章的卡池成员；kind→id 排序保证确定性
  const hits = (id: string): boolean => (inp.entityIndex[id] ?? []).includes(currentChapterId)
  const cards: { kind: string; id: string; json: string }[] = [
    ...inp.entityCards.character.map((c) => ({ kind: 'character', id: c.id, json: JSON.stringify(c) })),
    ...inp.entityCards.world.map((w) => ({ kind: 'world', id: w.id, json: JSON.stringify(w) }))
  ].filter((e) => hits(e.id))
  cards.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind < b.kind ? -1 : 1))
  if (cards.length > 0) {
    sections.push({ token: 'entity-cards', text: `${ENTITY_HEADER}\n${cards.map((c) => c.json).join('\n')}` })
  }

  // 2) 最近 3 章摘要：当前章 order 的前驱（严格小于），降序取 3，展示按升序
  const current = book.chapters.find((c) => c.id === currentChapterId)
  if (current) {
    const predecessors = book.chapters
      .filter((c) => c.order < current.order && (inp.chapterSummaries[c.id] ?? '').trim() !== '')
      .sort((a, b) => b.order - a.order)
      .slice(0, 3)
      .sort((a, b) => a.order - b.order)
    if (predecessors.length > 0) {
      sections.push({
        token: 'chapter-summaries',
        text: `${CHAPTER_SUMMARY_HEADER}\n${predecessors
          .map((c) => `${c.title}\n${inp.chapterSummaries[c.id]}`)
          .join('\n\n')}`
      })
    }
  }

  // 3) 当前卷梗概
  if (current?.volumeId) {
    const vs = (inp.volumeSummaries[current.volumeId] ?? '').trim()
    if (vs !== '') {
      sections.push({ token: 'volume-summary', text: `${VOLUME_SUMMARY_HEADER}\n${vs}` })
    }
  }

  // 4) 全书大纲线：synopsis + 大纲注记 + 卷列表（按 order 升序）
  const outlineLines: string[] = []
  if ((book.meta.synopsis ?? '').trim() !== '') outlineLines.push(`梗概：${book.meta.synopsis}`)
  if ((book.outlineNotes ?? '').trim() !== '') outlineLines.push(`大纲注记：${book.outlineNotes}`)
  const volumes = [...book.volumes].sort((a, b) => a.order - b.order)
  if (volumes.length > 0) {
    outlineLines.push(`卷列表：\n${volumes.map((v) => `${v.order}. ${v.title}（${v.id}）`).join('\n')}`)
  }
  if (outlineLines.length > 0) {
    sections.push({ token: 'outline', text: `${OUTLINE_HEADER}\n${outlineLines.join('\n')}` })
  }

  return sections
}

export function assembleAiContext(inp: ContextInputs): AssembledContext {
  const droppedFor: string[] = []
  const budget = inp.budgetTokens
  let truncated = false
  const marker = (): string => (truncated ? BODY_TRUNCATION_MARKER : '')
  const userOf = (b: string): string => USER_BODY_HEADER + marker() + b

  // —— 阶段 1：正文 80% 上限（先于段装配，续写场景保尾） ——
  let body = inp.chapterBody
  const cap = Math.floor(budget * 0.8)
  if (body !== '' && estimateTokens(USER_BODY_HEADER + body) > cap) {
    truncated = true
    body = longestTailToFit(body, (tail) =>
      estimateTokens(USER_BODY_HEADER + BODY_TRUNCATION_MARKER + tail) <= cap
    )
    droppedFor.push('body-truncated')
  }

  const systemOf = (sections: Section[]): string =>
    sections.length === 0
      ? ORGANIZE_SYSTEM_SKELETON
      : `${ORGANIZE_SYSTEM_SKELETON}\n\n${sections.map((s) => s.text).join('\n\n')}`
  const estOf = (sections: Section[], b: string): number =>
    estimateTokens(systemOf(sections) + userOf(b))

  // —— 阶段 2：从最低优先级整段丢弃直至入预算 ——
  let sections = buildSections(inp)
  while (sections.length > 0 && estOf(sections, body) > budget) {
    droppedFor.push(sections[sections.length - 1].token)
    sections = sections.slice(0, -1)
  }

  // —— 阶段 3：丢无可丢仍超预算 → 正文进一步压缩到剩余预算（骨架绝不丢弃） ——
  if (estOf(sections, body) > budget) {
    truncated = true
    if (!droppedFor.includes('body-truncated')) droppedFor.push('body-truncated')
    body = longestTailToFit(body, (tail) =>
      estimateTokens(ORGANIZE_SYSTEM_SKELETON + USER_BODY_HEADER + BODY_TRUNCATION_MARKER + tail) <= budget
    )
  }

  const messages: AiMessage[] = [
    { role: 'system', content: systemOf(sections) },
    { role: 'user', content: userOf(body) }
  ]
  return {
    messages,
    droppedFor,
    estTokens: estimateTokens(messages.map((m) => m.content).join(''))
  }
}
