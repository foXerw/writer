// 叙事通道（plotline:*/choice:*/foreshadow:*）错误前缀 → 中文文案的单一权威表
//（M4c-2 Task 5；姿态镜像 services/aiErrorText——词表一处维护、面板只引它，不再各自抄翻译）。
// 词表来源 = electron/main/bookStore/narrative.ts 的实际 throw 点（Task 8 钉死）：
//   [busy]（chatService 在途门，防御性收入——叙事通道本身不产此 tag，但门面错误若经
//   AI 管线冒出来也该可读）/ REF_BROKEN / FORESHADOW_TRANSITION / FORESHADOW_MISSING /
//   FORESHADOW_INVALID / PLOTLINE_{TITLE_INVALID,MISSING,INVALID} / CHOICE_{TITLE_INVALID,
//   MISSING,INVALID} / BAD_PLOTLINE_ID / BAD_CHOICE_ID / BAD_FORESHADOW_ID。
// PROPOSAL_* 不在本表——提案面文案属 adopt/proposal 域（Task 6 另立词表）。
// 匹配纪律（bookErrors.ts / useAI.test.ts 交过的学费）：electron 会把 handler 拒绝包成
// `Error invoking remote method 'plotline:update': Error: REF_BROKEN: …`，故先经
// parseKindTaggedError 剥包装 + 裁尾部 stack，再对解包文本做【锚定】前缀匹配——
// 绝不全文扫描（正文字样里出现「REF_BROKEN」不该被误路由）。
import { parseKindTaggedError } from '../hooks/useAI'

const NARRATIVE_ERROR_TEXT: Record<string, string> = {
  REF_BROKEN: '引用了已不存在的章节或实体',
  FORESHADOW_TRANSITION: '该伏笔当前状态不允许此操作（回收/弃置只适用于未回收条目，回收/弃置后请先重开）',
  FORESHADOW_MISSING: '伏笔条目不存在（可能刚被删除）',
  FORESHADOW_INVALID: '伏笔台账数据已损坏，应用未做任何修改',
  PLOTLINE_TITLE_INVALID: '剧情线标题不能为空白或含换行',
  PLOTLINE_MISSING: '剧情线不存在（可能刚被删除）',
  PLOTLINE_INVALID: '剧情线数据格式非法',
  CHOICE_TITLE_INVALID: '选项标题不能为空白或含换行',
  CHOICE_MISSING: '关键选项不存在（可能刚被删除）',
  CHOICE_INVALID: '关键选项数据格式非法',
  BAD_PLOTLINE_ID: '剧情线 id 非法（请刷新列表后重试）',
  BAD_CHOICE_ID: '关键选项 id 非法（请刷新列表后重试）',
  BAD_FORESHADOW_ID: '伏笔 id 非法（请刷新列表后重试）'
}

// 前缀形如 `REF_BROKEN: <id>`；也容忍裸前缀（`CHOICE_INVALID` 无冒号的理论形态）。
const PREFIX_RE = /^([A-Z][A-Z0-9_]*)(?::\s*)?([\s\S]*)$/

/**
 * 通道原始错误串 → 用户可读中文。label + 「：detail」拼接姿态同 aiErrorToast
 *（detail = 前缀冒号后的原文，含坏形状校验的字段级错误清单，保留可诊断性）。
 * 解不出已知前缀时回落「操作失败：<解包原文>」——绝不吞掉真实原因。
 */
export function narrativeErrorText(raw: string): string {
  const { kind, message } = parseKindTaggedError(raw)
  // 加固批 item 4：锚定匹配前先 trim 解包文本（与 proposalErrors 逐字节同式的 PREFIX_RE
  // 此前唯有本表不 trim——前导空白消息错过 ^[A-Z] 锚定、掉进泛化回落，两表不对称）。
  const unwrapped = message.trim()
  // [busy] tag 由 parseKindTaggedError 解出并剥掉；单独归一（在途门与本域写入互斥的场景防御）
  if (kind === 'busy') return `已有请求在途：${unwrapped}`
  const m = PREFIX_RE.exec(unwrapped)
  if (m && NARRATIVE_ERROR_TEXT[m[1]]) {
    const detail = m[2].trim()
    return detail ? `${NARRATIVE_ERROR_TEXT[m[1]]}：${detail}` : NARRATIVE_ERROR_TEXT[m[1]]
  }
  return unwrapped ? `操作失败：${unwrapped}` : '操作失败'
}
