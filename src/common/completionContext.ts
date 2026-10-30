// M5 Task 1：实时补全（ghost text）的上下文装配器（纯函数、零 I/O，主/渲染皆可共用）。
// 补全走低延迟小请求，上下文预算远小于整理管道，且 ai-context.ts 是「整理」专用的确定性
// 序列化层（37 测试 + e2e 钉死），二者刻意不共享——本文件单列一条轻量投影：
// - 设定卡投影成人读短句而非 JSON：一次补全往往只带两三张卡，token 成本必须压低；
//   字段截断按码点（Array.from）而非 UTF-16 码元，边界绝不劈开代理对（emoji 等 astral 字符）。
// - entitiesForChapter 反查 buildEntityChapterRefs 的实体→章节表，挑出「本章出现过的实体」。
//   结果按实体 id 字典序：同一输入必得同一卡序，prompt 前缀才可稳定命中模型端缓存。
// - buildCompletionPrompt 固定「卡在前、正文在后」的骨架——设定优先级高于临场发挥；
//   并显式授权「无卡时依语气自由续写」，空卡不该让模型哑火。空块（无卡/无梗概/
//   光标后无文/预算为零）整块省略，不留 dangling 段标题。

import type { CharacterV2, WorldEntryV2 } from './schema'

/** 角色卡单字段截断上限（码点）。 */
const CHARACTER_FIELD_MAX_CHARS = 80
/** 词条卡 content 截断上限（码点）。 */
const WORLD_CONTENT_MAX_CHARS = 120
/** 光标后余文的保留上限（码点）。 */
const PROSE_AFTER_MAX_CHARS = 200

/** 按码点取前 n 字；n<=0 得空串（避开 slice(-0) 全量陷阱）。 */
function headByCodePoint(text: string, n: number): string {
  if (n <= 0) return ''
  const cps = Array.from(text)
  return cps.length <= n ? text : cps.slice(0, n).join('')
}

/** 按码点取尾 n 字：光标前的正文语义上最靠近光标的是尾部，保尾即保语境。 */
function tailByCodePoint(text: string, n: number): string {
  if (n <= 0) return ''
  const cps = Array.from(text)
  return cps.length <= n ? text : cps.slice(cps.length - n).join('')
}

/**
 * 角色卡投影：`name（role）：appearance／personality／background`。
 * 各字段截 80 码点；纯空白字段跳过；三字段全空则只剩 `name（role）`（不带悬空冒号）。
 */
export function projectCharacterCard(c: CharacterV2): string {
  const parts = [c.appearance, c.personality, c.background]
    .map(field => headByCodePoint(field.trim(), CHARACTER_FIELD_MAX_CHARS))
    .filter(field => field !== '')
  const label = `${c.name}（${c.role}）`
  return parts.length === 0 ? label : `${label}：${parts.join('／')}`
}

/**
 * 词条卡投影：`title（category）：content`，content 截 120 码点；空 content 只剩前缀。
 * 注意 schema 现名是 title（brief 里的「name」为口径笔误，此处以真实字段为准）。
 */
export function projectWorldCard(w: WorldEntryV2): string {
  const label = `${w.title}（${w.category}）`
  const content = headByCodePoint(w.content.trim(), WORLD_CONTENT_MAX_CHARS)
  return content === '' ? label : `${label}：${content}`
}

/**
 * 反查「本章引用了哪些实体」：refs（buildEntityChapterRefs 的产物，实体 id→章节 id 清单）
 * 中 value 含 chapterId 的 key 集，按 key 字典序升序——确定性输出，可直接作缓存键。
 */
export function entitiesForChapter(refs: Record<string, string[]>, chapterId: string): string[] {
  return Object.keys(refs)
    .filter(entityId => (refs[entityId] ?? []).includes(chapterId))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export interface CompletionPromptArgs {
  /** 光标前正文（装配层已按 token 预算裁出窗口）。 */
  proseBefore: string
  /** 光标后余文，可为空串（光标在段末/章末）。 */
  proseAfter: string
  /** 已投影的设定卡行（projectCharacterCard/projectWorldCard 的产物），顺序即展示顺序。 */
  cards: string[]
  bookName: string
  synopsis: string
  /** 光标前正文保留上限（码点），由触发层按预算给出。 */
  maxChars: number
}

export interface CompletionPrompt {
  system: string
  user: string
}

const COMPLETION_SYSTEM_PROMPT =
  '你是本书的合写者。优先依据给出的设定卡描写；无卡时依正文语气自由续写，但不得与已给设定矛盾；' +
  '只输出接续正文，不解释不引用标记。'

const COMPLETION_TAIL_INSTRUCTION = '请接续光标处写 ≤3 句（≤120 字），遇段落意思完整即停。'

/**
 * 装配补全 prompt：system 固定「合写者人格」骨架；user 依序
 * 书名→梗概→相关设定卡→光标前（保尾 maxChars）→光标后（保头 200）→指令句。
 * 卡块永远排在正文块之前；空块省略；段间以空行分隔。纯函数，同入参两次装配逐字段相等。
 */
export function buildCompletionPrompt(args: CompletionPromptArgs): CompletionPrompt {
  const blocks: string[] = [`【书名】${args.bookName}`]
  const synopsis = args.synopsis.trim()
  if (synopsis !== '') blocks.push(`【梗概】${synopsis}`)
  if (args.cards.length > 0) blocks.push(`【相关设定】\n${args.cards.join('\n')}`)
  const before = tailByCodePoint(args.proseBefore, args.maxChars)
  if (before !== '') blocks.push(`【正文·光标前】\n${before}`)
  const after = headByCodePoint(args.proseAfter, PROSE_AFTER_MAX_CHARS)
  if (after !== '') blocks.push(`【光标后余文】\n${after}`)
  blocks.push(COMPLETION_TAIL_INSTRUCTION)
  return { system: COMPLETION_SYSTEM_PROMPT, user: blocks.join('\n\n') }
}
