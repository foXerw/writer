// 审阅通道（review:get/saveRun/dismiss/markConverted）错误前缀 → 中文文案的单一权威表
//（M6 Task 6 carry-in 2；姿态逐字镜像 proposalErrors/narrativeErrors/aiErrorText——词表一处维护、
// 对话框/钩子只引它，不再各自抄翻译，未映射一律回落「操作失败：<原文>」绝不吞真实原因）。
// 词表来源 = electron 侧审阅域的实际 throw 点（reviewErrors.test.ts 的「词表全覆盖」grep 钉死）：
//   bookStore/reviews.ts —— REVIEW_INVALID（自家产物校验失败/proposalId 空，抛在任何盘操作之前）、
//                   REVIEW_MISSING（dismiss/markConverted 目标意见不存在）、
//                   REVIEW_NOT_OPEN（状态迁移守卫：converted/stale/dismissed 不可再迁移）、
//                   BAD_REVIEW_CHAPTER_ID（chapterId 非 UUID——路径安全门，join 重定向封死）；
//   ipc/modules/reviews.ts —— REVIEW_CHAPTER_MISSING（saveRun 盖章：被审章非现存章）、
//                   REVIEW_TOO_MANY（单 run 意见数帽 200，通道级政策 PROPOSAL_TOO_LARGE 先例同款）。
// 匹配纪律同 proposalErrors：electron 把 handler 拒绝包成
// `Error invoking remote method 'review:dismiss': Error: REVIEW_…: …`，故先经
// parseKindTaggedError 剥包装 + 裁尾部 stack，再对解包文本做【锚定】前缀匹配。
import { parseKindTaggedError } from '../hooks/useAI'

const REVIEW_ERROR_TEXT: Record<string, string> = {
  REVIEW_INVALID: '审阅意见数据非法（账本未做任何修改）',
  REVIEW_MISSING: '该审阅意见已不存在（可能已被驳回、转化或删除）',
  REVIEW_NOT_OPEN: '该意见已不是待处理状态（驳回/转化/置旧后不可重复操作）',
  REVIEW_CHAPTER_MISSING: '被审章节已不存在（意见未写入账本）',
  REVIEW_TOO_MANY: '本章审阅意见条数超限（一章最多 200 条）',
  BAD_REVIEW_CHAPTER_ID: '审阅账本章节 id 非法（请重新打开书籍后重试）'
}

// 前缀形如 `REVIEW_MISSING: <id>`；也容忍裸前缀（无冒号的理论形态）。同 proposalErrors 的锚定式。
const PREFIX_RE = /^([A-Z][A-Z0-9_]*)(?::\s*)?([\s\S]*)$/

/**
 * 通道原始错误串 → 用户可读中文。label + 「：detail」拼接姿态同 proposalErrorText/aiErrorToast
 *（detail = 前缀冒号后的原文——意见 id/超限计数/字段级校验清单等，保留可诊断性）。
 * 解不出已知前缀时回落「操作失败：<解包原文>」——绝不吞掉真实原因。
 */
export function reviewErrorText(raw: string): string {
  const { kind, message } = parseKindTaggedError(raw)
  // [busy] tag 由 parseKindTaggedError 解出并剥掉；单独归一（镜像 proposalErrors 的场景防御）
  const unwrapped = message.trim()
  if (kind === 'busy') return `已有请求在途：${unwrapped}`
  const m = PREFIX_RE.exec(unwrapped)
  if (m && REVIEW_ERROR_TEXT[m[1]]) {
    const detail = m[2].trim()
    return detail ? `${REVIEW_ERROR_TEXT[m[1]]}：${detail}` : REVIEW_ERROR_TEXT[m[1]]
  }
  return unwrapped ? `操作失败：${unwrapped}` : '操作失败'
}
