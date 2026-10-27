// M4b 整理闭环——organize 提示词构造（T2，纯函数、零 I/O、主/渲染共用）。
//
// 单一权威原则：op×entity 组合表与 quote 长度上限都从 proposal.ts 的运行时值
// （ALLOWED_OPS / QUOTE_MAX_LENGTH）渲染进规约文本——改了表，prompt 自动跟随，
// 提示词与校验器永不漂移。
//
// chapterId 裁定（dispatch ruling）：AI 只输出 source.quote，绝不复述章节 id；
// 出处章节由 T4 在解析后统一盖章写进每条 change.source.chapterId——
// 减少 AI 输出面，杜绝 UUID 幻觉导致的校验失败。
//
// 信封裁定：AI 只产 {changes:[...]}；ProposalFile 的 id/createdAt/aiModel/status
// 外层字段由 T4 构造，规约文本如实告知模型，防止模型自作主张输出外层字段。

import { ALLOWED_OPS, QUOTE_MAX_LENGTH } from './proposal'
import type { AiMessage } from './ai-types'
import type { AssembledContext } from './ai-context'
import type { ForeshadowEntry } from './schema'

// ---------------------------------------------------------------------------
// 输出规约段（静态文本，与章节数据无关，可独立测试）
// ---------------------------------------------------------------------------

/** 组合表中允许 op 的集合（按实体表首现序，当前为 create/update/delete）。 */
function opsInTable(): string[] {
  return Array.from(new Set(Object.values(ALLOWED_OPS).flat()))
}

/** 每个 op 渲染一行 `- <op>：<entity, entity, ...>`，实体取 ALLOWED_OPS 键序。 */
function renderOpTable(): string {
  return opsInTable()
    .map((op) => {
      const entities = Object.entries(ALLOWED_OPS)
        .filter(([, allowed]) => (allowed as string[]).includes(op))
        .map(([entity]) => entity)
        .join(', ')
      return `- ${op}：${entities === '' ? '（当前组合表下无可用 entity）' : entities}`
    })
    .join('\n')
}

/**
 * 提案输出规约：JSON 契约形状、组合表、引文铁律、origin 铁律、输出/数量纪律、伏笔核销。
 * 被 buildOrganizePrompt 追加到 system 骨架之后；确定性纯函数（两次调用逐字相等）。
 */
export function buildOrganizeContract(): string {
  return [
    '【输出规约】',
    '你的任务是针对当前章节正文，提议对全书资料库的变更（提案），由作者逐条审阅后决定采纳与否。',
    '',
    '一、输出格式（硬性要求）：',
    '- 只输出一个 JSON 对象，前后不得有任何解释文字，不得使用代码围栏。',
    '- 形如：{"changes":[{"op":"update","entity":"character","targetId":"…","after":{…},"source":{"quote":"…"},"overwritesHuman":true}]}',
    '- 你只产出 changes 数组；提案文件的 id、createdAt、aiModel、status 等外层字段由系统补全，不要输出。',
    '- 每条 change 的字段：op（动作）、entity（目标类型）、targetId（update/delete 必填，create 省略）、after（create/update 必填的新内容）、source.quote（出处引文）、overwritesHuman（仅 update 时有意义）。',
    '- source 只需给出 quote：出处章节由系统自动记录，当前章节 id 仅供你定位上下文，切勿在输出中复述。',
    '',
    '二、op×entity 合法组合（表外组合会被系统直接拒绝）：',
    renderOpTable(),
    '',
    '三、出处引文 source.quote 铁律：',
    `- 必须逐字引用本章正文原文（不超过 ${QUOTE_MAX_LENGTH} 字符），且必须能在正文中原样找到；不得改写、压缩或跨段拼接。`,
    '',
    '四、人手写内容保护（origin 铁律）：',
    '- 凡修改可能由作者手写的字段，该条提案必须显式设置 overwritesHuman:true，否则会被系统拒绝。',
    '- 不得提议删除 character 或 world——角色卡与世界观条目只能由作者亲手删除。',
    '',
    '五、伏笔核销：',
    '- 对照下方【待核销伏笔】清单逐条判断其是否已在本章回收：已回收 → 提议一条 update foreshadow（targetId 填该伏笔 id，after 中把 status 置为 resolved）；未回收 → 保持不动。',
    '',
    '六、数量纪律：',
    '- 只提议本章正文确有证据支持的变更，宁缺毋滥；绝不为凑数而提议。'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 伏笔清单段
// ---------------------------------------------------------------------------

function renderForeshadows(list: ForeshadowEntry[]): string {
  if (list.length === 0) {
    return '【待核销伏笔】\n当前无待核销伏笔。若本章正文出现新伏笔，可按规约提议 create foreshadow。'
  }
  const lines = list.map((f) => `- ${f.id} ${f.title}（埋于 ${f.plantedChapterId}）`).join('\n')
  return ['【待核销伏笔】', lines, '', '请按上方输出规约的伏笔核销要求，逐条对照本章正文判断。'].join('\n')
}

// ---------------------------------------------------------------------------
// 消息组装
// ---------------------------------------------------------------------------

/**
 * 在 assembleAiContext 产出的消息上，把「章节 header + 输出规约 + 伏笔清单」追加进
 * system 消息尾部；user 消息逐字节原样透传（红线：T1/T5 的装配断言依赖它）。
 * 绝不改动入参：所有 message 均为新对象。无 system 消息时兜底前置一条规约 system。
 */
export function buildOrganizePrompt(args: {
  assembled: AssembledContext
  chapterTitle: string
  chapterId: string
  pendingForeshadows: ForeshadowEntry[]
}): AiMessage[] {
  const { assembled, chapterTitle, chapterId, pendingForeshadows } = args
  const append = [
    `【本章整理任务】当前整理章节：《${chapterTitle}》（id：${chapterId}，仅供定位，勿在输出中复述）`,
    buildOrganizeContract(),
    renderForeshadows(pendingForeshadows)
  ].join('\n\n')

  let appended = false
  const messages: AiMessage[] = assembled.messages.map((m) => {
    if (!appended && m.role === 'system') {
      appended = true
      return { role: m.role, content: `${m.content}\n\n${append}` }
    }
    return { role: m.role, content: m.content }
  })
  if (!appended) {
    messages.unshift({ role: 'system', content: append })
  }
  return messages
}

// ---------------------------------------------------------------------------
// 预算 → 输出上限映射
// ---------------------------------------------------------------------------

/**
 * 输入预算（budgetTokens）→ 请求 maxTokens（输出上限）。
 * 裁定取线性夹取 clamp(budget, 2048, 16384) 而非乘数放大：organize 输出是一小段
 * JSON 提案，budget 约束的是输入侧；固定地板 2048 保证极小预算下也写得出完整
 * changes 数组，上限 16384 防病理预算撑爆输出窗口。简单、可钉死测试。
 */
export function budgetToMaxTokens(budgetTokens: number): number {
  return Math.min(Math.max(budgetTokens, 2048), 16384)
}
