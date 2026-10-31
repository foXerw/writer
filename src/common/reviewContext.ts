// M6 Task 2：审阅 prompt 上下文装配器 + 意见信封解析（纯函数、零 I/O、零时钟、零随机，主/渲染共用）。
// 兄弟先例：completionContext.ts（卡投影直接复用）、organizePrompt.ts（规约从单源常量渲染，
// 提示词与校验器永不漂移）。与整理/补全的关键差异：
// - 正文**全文入 prompt、不截断**：锚（quote）必须逐字可定位，砍段=砍锚；预算超顶在装配期
//   先拒（{kind:'over-budget'} 在任何发起之前，UI 据此拒绝收窄范围，零请求零花费）。
// - 正文按段编号呈现（`[N] ` 前缀）：编号用 reviewTypes.paragraphsOf——与 relocateAnchor
//   **同一条分段规则**（import 复用，绝不双写正则；T1 结转教训：各写各的会让 paraIndex
//   在 CRLF 书上系统性漂移，锚全面错位）。模型所见段号 = 渲染器所切段号。
// - 多章入参仅为整书语境呈现；编排侧每请求一章（spec Q5），paraIndex 在被审章块内唯一，
//   chapterId 由调用方按章注入——模型自带的章节复述一律覆写。
// - AI 只产 {opinions:[…]}；id/createdAt/model/status/stale 五信封字段由 T5 盖章
//   （纯函数不碰时钟与随机），proposalId 同理剔除（转化指针唯一写入口在仓库层）。

import type { CharacterV2, WorldEntryV2 } from './schema'
import { projectCharacterCard, projectWorldCard } from './completionContext'
import { extractJsonLoose } from './jsonLoose'
import { REVIEW_QUOTE_MAX_LENGTH, REVIEW_CATEGORIES, paragraphsOf, severityFor, validateReviewOpinion } from './reviewTypes'
import type { ReviewCategory, ReviewOpinion } from './reviewTypes'

/** prompt 侧引文约定（校验宽限 REVIEW_QUOTE_MAX_LENGTH=120 的 1/3——严规矩软着陆）。 */
export const REVIEW_QUOTE_PROMPT_MAX = 40

/** 被审章（正文 = 原样字节，装配层不改写任何换行）。 */
export interface ReviewPromptChapter {
  id: string
  title: string
  body: string
}

export type ReviewPromptResult =
  | { kind: 'ok'; system: string; user: string }
  /** 估算超顶：装配**之前**返回，不产 prompt（UI 拒绝发起，spec「预算硬顶按单请求计」）。 */
  | { kind: 'over-budget'; estimated: number }

export interface BuildReviewPromptArgs {
  bookName: string
  synopsis: string
  chapters: ReviewPromptChapter[]
  /** 已投影的设定卡行（reviewCardLine 产物），顺序即展示顺序。 */
  cards: string[]
  /** 台账 open 伏笔条目清单（伏笔对账依据，一行一条，调用方格式化）。 */
  openForeshadow: string[]
  /** 本次请求的输出 token 上限（同时作输入预算闸门——与 maxTokens 同数值口径，简单可钉死）。 */
  maxTokens: number
}

// ---------------------------------------------------------------------------
// 预算启发式（单点：计划钉死「估算=正文码点/2」，builder 可换但只许换在这一处）
// ---------------------------------------------------------------------------

/** 审阅输入体量估算（token）：全部章正文码点数 ÷ 2 向上取整。cards/system 刻意不计——
 * 正文是绝对大头，启发式宁粗勿繁，换式只改这个函数。 */
export function estimateReviewTokens(chapters: readonly { body: string }[]): number {
  let codePoints = 0
  for (const c of chapters) codePoints += Array.from(c.body).length
  return Math.ceil(codePoints / 2)
}

// ---------------------------------------------------------------------------
// system：读者人格 + 六类词典 + 输出信封契约（静态文本，与章节数据无关）
// ---------------------------------------------------------------------------

/** 六类判定标准一句（Record 穷尽键检查防漏类；渲染进 system，与 T1 白名单单源同呼吸）。 */
const CATEGORY_CRITERIA: Record<ReviewCategory, string> = {
  'foreshadow-unresolved': '台账所列伏笔在本章正文看不到任何回收或呼应的痕迹（对照台账逐条核对，无台账依据不要凭猜测上报）',
  'setting-conflict': '正文陈述与设定卡/世界观条目打架（地名、数字、能力、人物关系、时间线等硬事实不一致）',
  'motivation-break': '人物言行用其已立的目标/性格/背景解释不通，出现「他不会这么做」的断裂感',
  pacing: '篇幅与信息量、事件推进失衡（拖沓注水，或跳跃到读者跟不上）',
  flatness: '人物或场景缺少可辨识的特征与情绪起伏，读来面目模糊、一马平川',
  'prose-craft': '局部文字病套话、重复冗余、意象生硬、节奏与标点失当'
}

function renderCategoryTable(): string {
  return REVIEW_CATEGORIES.map(
    (c) =>
      `- ${c}（${severityFor(c) === 'hard' ? 'hard·硬对账' : 'soft·软感受'}）：${CATEGORY_CRITERIA[c]}`
  ).join('\n')
}

function buildReviewSystem(): string {
  return [
    [
      '你是这本书最较真的读者：通读全书至此，了解梗概与设定，现在以挑剔的眼光重读接下来的章节正文。',
      '你只指出问题并给出原文证据，不代写、不奉承；没有意见就如实返回空数组。'
    ].join(''),
    [
      '【意见六类】category 只能取下列枚举；severity 由类别决定（系统按配对表校验，失配整条丢弃）：',
      renderCategoryTable()
    ].join('\n'),
    [
      '【输出规约】（硬性要求）：',
      '- 只输出一个 JSON 对象，前后不得有解释文字，不得使用代码围栏。',
      '- 形如：{"opinions":[{"category":"…","severity":"…","anchor":{"quote":"…","paraIndex":0},"text":"…","suggestion":"…","targetEntityId":"…"}]}',
      '- anchor.quote 必须逐字取自【章节正文】单个段落的原文（不超过 ' +
        REVIEW_QUOTE_PROMPT_MAX +
        ` 字；超过 ${REVIEW_QUOTE_MAX_LENGTH} 字的病理输出会被系统整条丢弃）：不得改写、压缩或跨段拼接，绝不含段首「[N]」编号标记。`,
      '- anchor.paraIndex 照抄被引段行首的「[N]」编号（各章内从 0 起编；系统会按引文重新定位，编号只作提示）。',
      '- text 是意见本身（一至三句）；suggestion 可选，给方向不给改写；软感受类（pacing/flatness/prose-craft）一般无需 suggestion。',
      '- 硬对账三类尽量给 targetEntityId：逐字抄【设定卡】行首 [id]；拿不准就省略，绝不编造。',
      '- 你只产出 opinions 数组：id、createdAt、model、status、stale 等信封字段由系统补全，不要输出，也不要复述章节 id。',
      '- 章确无问题输出 {"opinions":[]} 是合法结果；宁缺毋滥，绝不为凑数编造问题。'
    ].join('\n')
  ].join('\n\n')
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

/**
 * 装配审阅 prompt：先判预算（超顶直接 over-budget，零装配）；user 依序
 * 书名→梗概→设定卡→未结伏笔台账→各章正文（**全文、逐段 [N] 编号**）→指令句。
 * 空块（书名/梗概/卡/台账）整块省略不留悬空头（completionContext 同款纪律）。
 * 纯函数：同入参两次装配逐字段相等。
 */
export function buildReviewPrompt(args: BuildReviewPromptArgs): ReviewPromptResult {
  const estimated = estimateReviewTokens(args.chapters)
  if (estimated > args.maxTokens) return { kind: 'over-budget', estimated }

  const blocks: string[] = []
  const bookName = args.bookName.trim()
  if (bookName !== '') blocks.push(`【书名】${bookName}`)
  const synopsis = args.synopsis.trim()
  if (synopsis !== '') blocks.push(`【梗概】${synopsis}`)
  if (args.cards.length > 0) blocks.push(`【设定卡】\n${args.cards.join('\n')}`)
  if (args.openForeshadow.length > 0) {
    blocks.push(`【未结伏笔台账】\n${args.openForeshadow.join('\n')}`)
  }
  for (const c of args.chapters) {
    // 段编号呈现 = paragraphsOf 单源分段（与 relocateAnchor 同一规则，段号永不漂移）；
    // 段文本原样呈现（含段内软换行字节），quote 逐字可取。
    const numbered = paragraphsOf(c.body)
      .map((p, i) => `[${i}] ${p.text}`)
      .join('\n')
    blocks.push(`【章节正文】《${c.title}》（id：${c.id}，仅供定位，勿在输出中复述）\n${numbered}`)
  }
  blocks.push('请依据系统提示的【输出规约】，对上述章节正文给出审阅意见 JSON。')
  return { kind: 'ok', system: buildReviewSystem(), user: blocks.join('\n\n') }
}

// ---------------------------------------------------------------------------
// 卡行投影（`[id] …` 前缀 + M5 投影函数复用——T5 装配 cards 的唯一格式化入口）
// ---------------------------------------------------------------------------

/** 审阅卡行：`[char-1] 沈孤鸿（protagonist）：…`——id 前缀让模型能逐字抄 targetEntityId（spec Q2）。 */
export function reviewCardLine(card: CharacterV2 | WorldEntryV2): string {
  const projected = 'role' in card ? projectCharacterCard(card) : projectWorldCard(card)
  return `[${card.id}] ${projected}`
}

// ---------------------------------------------------------------------------
// parseReviewOpinions：信封解析（organizeResult.buildProposalFromAi 同款姿态）
// ---------------------------------------------------------------------------

/** 半成品意见：信封五字段（id/createdAt/model/status/stale）由 T5 编排盖章——纯函数不碰时钟与随机。 */
export type ParsedOpinion = Omit<ReviewOpinion, 'id' | 'createdAt' | 'model' | 'status' | 'stale'>

export type ParseReviewResult =
  | { kind: 'ok'; opinions: ParsedOpinion[] }
  /** 抠不出 JSON/顶层非对象/opinions 缺失或非数组——结果不携任何原文（隐私红线同裁定 9）。 */
  | { kind: 'parse-failed' }

/** 校验期占位（validate 要求 id/model 非空串；真实盖章归 T5，占位值不外泄出解析层）。 */
const VALIDATION_STUB = 'review-parse-stub'

/**
 * 解析审阅输出：extractJsonLoose 抠 JSON → 信封逐条严格校验（走 validateReviewOpinion
 * 自家产物口径），**单条坏（类别表外/severity 失配/缺锚字段）丢弃、不沉全批**；
 * quote 不在正文**不丢弃**（解析层无正文，锚失判定归渲染期 relocateAnchor——G3 显式化）。
 * chapterId 调用方注入为唯一权威：模型自带的 chapterId/id/status/stale/createdAt/model/
 * proposalId 一律覆写剔除，绝不采信（organizeResult 裁定 1 同款立场）。
 */
export function parseReviewOpinions(raw: string, chapterId: string): ParseReviewResult {
  let parsed: unknown
  try {
    parsed = extractJsonLoose(raw)
  } catch {
    return { kind: 'parse-failed' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'parse-failed' }
  }
  const list = (parsed as Record<string, unknown>).opinions
  if (!Array.isArray(list)) return { kind: 'parse-failed' }

  const opinions: ParsedOpinion[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    // 源是 JSON.parse 的 plain object，spread 只复制 own 属性（__proto__ 键同理），无原型注入面
    const rec = { ...(item as Record<string, unknown>) }
    delete rec.id
    delete rec.createdAt
    delete rec.model
    delete rec.status
    delete rec.stale
    delete rec.proposalId
    const stamped = {
      ...rec,
      chapterId,
      id: VALIDATION_STUB,
      status: 'open',
      stale: false,
      createdAt: '',
      model: VALIDATION_STUB
    }
    if (validateReviewOpinion(stamped).length > 0) continue
    const src = stamped as unknown as ReviewOpinion
    const out: ParsedOpinion = {
      chapterId,
      category: src.category,
      severity: src.severity,
      anchor: { quote: src.anchor.quote, paraIndex: src.anchor.paraIndex },
      text: src.text
    }
    // 可选字段：显式白名单转写，模型幻觉出的多余键一律不带出解析层
    if (typeof src.suggestion === 'string') out.suggestion = src.suggestion
    if (typeof src.targetEntityId === 'string') out.targetEntityId = src.targetEntityId
    opinions.push(out)
  }
  return { kind: 'ok', opinions }
}
