// M6 T4——审阅意见→提案 change 转化映射（纯函数，主/渲染共用：不碰 fs/ipc，只回 change；
// 落盘归 T5 编排经 proposal:save / proposal:appendChanges，cid 由 appendProposalChanges 盖章）。
//
// 映射表（spec 发起人拍板 4/5：硬三类可转提案，软三类只可驳回）：
// - foreshadow-unresolved → create×foreshadow：after 播种台账条目（title=意见文本前 30 码点、
//   plantedChapterId=意见章、status='open'、plannedPayoffNote=suggestion 回落 text、
//   resolvedChapterId 显式 null——validateForeshadowEntry 要求 string|null 在场）；无 target 需求。
//   id 刻意不播种：adoptCreateForeshadow 一律注入新鲜 UUID（伪造 id 撞存量 = 静默改写）。
// - setting-conflict → update×world：target=o.targetEntityId 且必须命中 ctx.world；
//   after=整卡拷贝 + content 追加建议段（\n\n 分段——同 reviewTypes 分段口径的写侧镜像）。
// - motivation-break → update×character：target 必须命中 ctx.characters；
//   after=整卡拷贝 + goals 或 flaws 追加建议段。路由规则（T5 裁定翻转后钉死）：默认 goals
//   （动机=为何行动=目标维度），仅意见 text 或 suggestion 明提「性格/缺陷/弱点」→ flaws
//   （人物缺陷维度）；两字段缺席/空串时追加段独占字段（无前置换行）。
// - targetEntityId 缺失/空串/错域（指向另一域的 id）→ need-target + 对应域全列表候选
//   （setting-conflict→world 列表 name=title；motivation-break→character 列表 name=name；
//   一律按 name 码元字典序升序——刻意不用 localeCompare：默认 locale 随机器漂移，见 byName 注）。
//   域预滤是硬要求：character 永不进 world 候选，反之亦然（选择器直接可渲染）。
// - 软三类（pacing/flatness/prose-craft）→ invalid('soft-not-convertible')——散文是作者地盘。
//
// overwritesHuman 口径：两条 update 映射改写的是人写 content/goals/flaws（R1 origin 守卫必拦），
// 故旗标恒置 true——作者点「转提案」+ 差异面板确认正是显式覆盖授权本身（T5 把该键送进
// confirmedOverwrite）。create 不带（旗标仅对 update 有意义）。
//
// 产物自检口径：source.quote 直取 anchor.quote（自家产物经 validateReviewOpinion 保证
// 非空 ≤120 < QUOTE_MAX_LENGTH=300，validateChange 同把门天然通过）。

import type { ProposalChange } from './proposal'
import type { CharacterV2, WorldEntryV2 } from './schema'
import type { ReviewOpinion } from './reviewTypes'
import { SOFT_CATEGORIES } from './reviewTypes'

/** 转化上下文（T5 从仓库装载传入——本模块零 IO，域数据是入参不是读取）。 */
export interface ReviewConvertContext {
  characters: CharacterV2[]
  world: WorldEntryV2[]
}

/** 候选条目（need-target 时供选择器渲染；name 序升序）。 */
export interface ReviewTargetCandidate {
  id: string
  name: string
}

export type ReviewConvertResult =
  | { kind: 'ok'; change: ProposalChange }
  | { kind: 'need-target'; candidates: ReviewTargetCandidate[] }
  | { kind: 'invalid'; reason: string }

/** title 摘要长度（意见文本截断，码点计——emoji 代理对不劈叉）。 */
const TITLE_MAX = 30

/** 追加段分隔（正文段落口径：空行分段，同 reviewTypes.paragraphsOf 的读侧镜像）。 */
const PARA_SEP = '\n\n'

/**
 * 追加段/播种段正文：suggestion 优先（可执行建议本就是转化的载荷），
 * 缺席或全空白回落意见文本——转化必须带作者可操作内容，绝不落空段。
 */
function convertPayload(o: ReviewOpinion): string {
  const s = o.suggestion?.trim() ?? ''
  return s !== '' ? s : o.text.trim()
}

/** 既有字段值 + 空行 + 新段；底文空白 → 新段独占（不留下孤零零的前置换行）。 */
function appendParagraph(base: string | undefined, addition: string): string {
  if (base === undefined || base.trim() === '') return addition
  return `${base}${PARA_SEP}${addition}`
}

/**
 * 动机断裂的字段路由（裁定翻转，M6 T5 控制器代裁）：默认 goals——动机=为何行动=目标维度；
 * 仅意见文本明提「性格/缺陷/弱点」（人物缺陷词）才落 flaws。「动机」本身不再指向 flaws
 * （旧规则把「动机断裂」记进缺陷栏，语义拧反——终验汇报留发起人否决口）。
 */
function motivationField(o: ReviewOpinion): 'goals' | 'flaws' {
  const pool = `${o.text}${o.suggestion ?? ''}`
  return pool.includes('性格') || pool.includes('缺陷') || pool.includes('弱点') ? 'flaws' : 'goals'
}

/**
 * 候选列表：域预滤（只收本域）+ {id,name} 投影 + 按 name 升序。
 * 排序口径 = UTF-16 码元字典序（`<` 比较）而非 localeCompare——localeCompare 随运行机器的
 * 默认 ICU locale 漂移（CJK vs Latin 相对序在 zh/en 下不同），纯函数与测试必须跨机确定。
 */
function byName(list: ReviewTargetCandidate[]): ReviewTargetCandidate[] {
  return list
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** 意见→提案 change（映射表与口径见文件头注；纯函数，同入参恒同输出）。 */
export function opinionToChange(
  o: ReviewOpinion,
  ctx: ReviewConvertContext
): ReviewConvertResult {
  if (SOFT_CATEGORIES.includes(o.category)) {
    return { kind: 'invalid', reason: 'soft-not-convertible' }
  }

  const source = { chapterId: o.chapterId, quote: o.anchor.quote }

  switch (o.category) {
    case 'foreshadow-unresolved': {
      const summary = Array.from(o.text.trim()).slice(0, TITLE_MAX).join('')
      const after = {
        title: summary,
        plantedChapterId: o.chapterId,
        plannedPayoffNote: convertPayload(o),
        resolvedChapterId: null,
        status: 'open' as const
      }
      const change: ProposalChange = { op: 'create', entity: 'foreshadow', after, source }
      return { kind: 'ok', change }
    }

    case 'setting-conflict': {
      const target = ctx.world.find((w) => w.id === o.targetEntityId)
      if (!target) {
        return {
          kind: 'need-target',
          candidates: byName(ctx.world.map((w) => ({ id: w.id, name: w.title })))
        }
      }
      const after: WorldEntryV2 = {
        ...target,
        content: appendParagraph(target.content, convertPayload(o))
      }
      const change: ProposalChange = {
        op: 'update',
        entity: 'world',
        targetId: target.id,
        after,
        source,
        overwritesHuman: true
      }
      return { kind: 'ok', change }
    }

    case 'motivation-break': {
      const target = ctx.characters.find((c) => c.id === o.targetEntityId)
      if (!target) {
        return {
          kind: 'need-target',
          candidates: byName(ctx.characters.map((c) => ({ id: c.id, name: c.name })))
        }
      }
      const field = motivationField(o)
      const addition = convertPayload(o)
      const after: CharacterV2 =
        field === 'flaws'
          ? { ...target, flaws: appendParagraph(target.flaws, addition) }
          : { ...target, goals: appendParagraph(target.goals, addition) }
      const change: ProposalChange = {
        op: 'update',
        entity: 'character',
        targetId: target.id,
        after,
        source,
        overwritesHuman: true
      }
      return { kind: 'ok', change }
    }

    default:
      // 理论不可达（六类白名单：软三类已在入口拦回）——防御兜底，绝不误产 change。
      return { kind: 'invalid', reason: `unknown-category:${String(o.category)}` }
  }
}
