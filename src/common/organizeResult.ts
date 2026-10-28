// organize 结果构造（M4b Task 4：AI 全文 → ProposalFile 的纯函数收口，主/渲染共用）。
// useOrganize（渲染 hook）只做 I/O 编排；「解析 + 盖章 + 校验」这段可测纯逻辑全部压在这里——
// 无 jsdom 环境下的 hook 覆盖缺口由本模块的单测兜住（Task 6 CDP 冒烟兜交互面）。
//
// 三条控制器结转裁定在此落实（详见 task-4-brief / 任务派发词）：
// - 裁定 1（盖章序）：AI 只输出 source.quote（organizePrompt.ts 契约），本章 id 由本函数在
//   validateProposal【之前】统一盖进每条 change.source.chapterId——顺序反了每条都栽在
//   proposal.ts 的 UUID 形状检查上（change.source.chapterId: expected UUID string）。
//   AI 若违约自带 chapterId（幻觉/复述上下文头），一律被整理章覆写，绝不采信。
// - 裁定 2（空语义）：changes 空/缺失/非数组 → 'empty'——不落盘、不算错误，调用方
//   message.info('AI 未发现需要记录的变更') 并复位徽章。
// - 裁定 9（隐私）：'parse-failed' 分支不携带任何原文（可能引用书中内容），调用方需要留痕
//   也只许记长度。
//
// M4c-1（稳定变更标识）：每条 change 在此盖章新鲜 `cid`（记账主键，adopt/markSettled/reject/
// 面板勾选全走 changeKey 键域）。AI 违约自带 cid 与 chapterId 同立场——一律覆写，绝不采信
// （伪造/碰撞 cid 会污染键域记账）。Web Crypto randomUUID（渲染进程恒安全上下文）；
// 极端环境退化兜底仍保证非空字符串唯一（校验器不强制 UUID 形状）。
//
// 信封字段（id/createdAt/aiModel/status）由本函数构造（organizePrompt 规约文本已如实告知模型）。

import { extractJsonLoose } from './jsonLoose'
import { newProposalId, validateProposal } from './proposal'
import type { ProposalChange, ProposalFile } from './proposal'

export type BuildProposalResult =
  /** 盖章 + 校验通过：可直接送 proposal:save（主进程双保险再校验） */
  | { kind: 'ok'; file: ProposalFile }
  /** 裁定 2：AI 未发现需要记录的变更（changes 空/缺失/非数组/顶层非对象） */
  | { kind: 'empty' }
  /** 全文抠不出 JSON（extractJsonLoose 抛）——不带原文 */
  | { kind: 'parse-failed' }
  /** 抠出了 JSON 但结构/组合表/引用形状不合提案契约 */
  | { kind: 'invalid'; errors: string[] }

/**
 * 把 AI 整理全文铸成提案文件。
 * @param raw     ai:chunk 累加出的完整模型输出文本
 * @param chapterId 整理章 id（UUID；盖进信封与每条 source，出处唯一权威）
 * @param aiModel   生成用模型名（渲染层按 chatService 同款解析式从 AiSettingsView 复算；
 *                  validateProposal 的非空门会拦下空串——宁拒不落假名）
 */
export function buildProposalFromAi(raw: string, chapterId: string, aiModel: string): BuildProposalResult {
  let parsed: unknown
  try {
    parsed = extractJsonLoose(raw)
  } catch {
    return { kind: 'parse-failed' }
  }

  // 顶层非对象（数组/原始值/null）与 changes 缺失/非数组同归「空语义」（裁定 2 字面：
  // parsed.changes 空/缺失 → 不落盘不判错）；对数组/原始值取 .changes 即 undefined，行为一致。
  const changes =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).changes
      : undefined
  const list = Array.isArray(changes) ? changes : []
  if (list.length === 0) return { kind: 'empty' }

  const file: ProposalFile = {
    id: newProposalId(chapterId, Date.now()),
    chapterId,
    createdAt: new Date().toISOString(),
    aiModel,
    status: 'pending',
    // 裁定 1：先盖章、后校验。source 整体缺失时兜底成 {chapterId}（形状由 quote 检查拒下，
    // 而不是 spread undefined 崩在这里）。spread 源是经 JSON.parse 的 plain object，
    // __proto__ 键只是 own property，不会触发原型 setter。
    // M4c-1：cid 盖章先删后赋——AI 违约自带的 cid 绝不采信（覆写成新鲜值），cid 置条目首位
    // （YAML 落盘可读性：记账主键打头）。
    changes: list.map((c) => {
      const rec = asRecord(c)
      delete rec.cid
      return {
        cid: newChangeId(),
        ...rec,
        source: { ...asSourceRecord(c), chapterId }
      } as ProposalChange
    })
  }

  const errors = validateProposal(file)
  if (errors.length > 0) return { kind: 'invalid', errors }
  return { kind: 'ok', file }
}

/**
 * cid 生产（M4c-1）：Web Crypto randomUUID（Electron 渲染进程恒为安全上下文；vitest/node ≥19
 * 自带 globalThis.crypto）。极端环境（无 crypto）退化兜底 = 时间戳+随机串——校验器只要求
 * 非空字符串，唯一性由随机位宽保证（同 useAI.genRequestId 的兜底先例）。
 */
function newChangeId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** 对象记录形状（非对象/数组 → 空记录，交由校验器报结构错）。 */
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** 取 change.source 的记录形状（非对象 → 空记录，交由校验器报 source 形状错）。 */
function asSourceRecord(c: unknown): Record<string, unknown> {
  return asRecord(asRecord(c).source)
}
