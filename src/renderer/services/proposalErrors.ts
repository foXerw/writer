// 提案通道（proposal:save/adopt/reject/get/getAll）错误前缀 → 中文文案的单一权威表
//（M4c-2 Task 6 结转；姿态镜像 services/aiErrorText 与 narrativeErrors——词表一处维护、
// 面板/hook 只引它，不再各自抄翻译，未映射一律回落「操作失败：<原文>」绝不吞真实原因）。
// 词表来源 = electron 侧的实际 throw 点（Task 8 起收口核对）：
//   proposals.ts —— PROPOSAL_INVALID（坏档/结构非法抛穿）、BAD_PROPOSAL_ID（路径安全门）、
//                   PROPOSAL_MISSING（点读缺失）；
//   ipc/modules/proposal.ts —— PROPOSAL_TOO_LARGE（200 条上限）、PROPOSAL_CHAPTER_MISSING
//                   （盖章章不存在）、PROPOSAL_DUPLICATE（同章去重闸门，Task 6 P2）；
//   adopt.ts —— PROPOSAL_BAD_PARAMS（changeKeys 非数组，通道级抛穿）。
// 逐条 `REFUSED: …` 不在此表——那是条目级对账数据（面板按 key 对号展示），语义归引擎 reason 文本。
// 匹配纪律同 narrativeErrors：electron 把 handler 拒绝包成
// `Error invoking remote method 'proposal:save': Error: PROPOSAL_…: …`，故先经
// parseKindTaggedError 剥包装 + 裁尾部 stack，再对解包文本做【锚定】前缀匹配。
import { parseKindTaggedError } from '../hooks/useAI'

const PROPOSAL_ERROR_TEXT: Record<string, string> = {
  PROPOSAL_INVALID: '提案文件格式非法（数据已损坏，应用未做任何修改）',
  PROPOSAL_TOO_LARGE: '提案变更条目数超限（一份提案最多 200 条）',
  PROPOSAL_DUPLICATE: '该章已有待处理的提案（请先在审阅面板消化后再次整理）',
  PROPOSAL_CHAPTER_MISSING: '提案的出处章节已不存在',
  PROPOSAL_MISSING: '提案不存在（可能已被他端消化或删除）',
  PROPOSAL_BAD_PARAMS: '提案操作参数不合法',
  BAD_PROPOSAL_ID: '提案 id 非法（请刷新列表后重试）'
}

// 前缀形如 `PROPOSAL_MISSING: <id>`；也容忍裸前缀（无冒号的理论形态）。同 narrativeErrors 的锚定式。
const PREFIX_RE = /^([A-Z][A-Z0-9_]*)(?::\s*)?([\s\S]*)$/

/**
 * 通道原始错误串 → 用户可读中文。label + 「：detail」拼接姿态同 aiErrorToast/narrativeErrorText
 *（detail = 前缀冒号后的原文——提案 id/超限计数等，保留可诊断性）。
 * 解不出已知前缀时回落「操作失败：<解包原文>」——绝不吞掉真实原因。
 */
export function proposalErrorText(raw: string): string {
  const { kind, message } = parseKindTaggedError(raw)
  // [busy] tag 由 parseKindTaggedError 解出并剥掉；单独归一（镜像 narrativeErrors 的场景防御）
  const unwrapped = message.trim()
  if (kind === 'busy') return `已有请求在途：${unwrapped}`
  const m = PREFIX_RE.exec(unwrapped)
  if (m && PROPOSAL_ERROR_TEXT[m[1]]) {
    const detail = m[2].trim()
    return detail ? `${PROPOSAL_ERROR_TEXT[m[1]]}：${detail}` : PROPOSAL_ERROR_TEXT[m[1]]
  }
  return unwrapped ? `操作失败：${unwrapped}` : '操作失败'
}
