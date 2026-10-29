// useOrganize 外层 catch 的 toast 文案归一（结转微批 #2 item 3，抽成纯函数供无 jsdom 单测，
// 镜像 chapterRefresh.ts / ledgerFallback.ts 先例——hook 体内 catch 不可测，文案逻辑外提）。
// 病灶：withLedgerLoudError（ledgerFallback.ts）重抛的消息经 narrativeErrorText 泛化回落正是
// 「操作失败：<原文>」，外层 catch 再叠「整理失败：」→ 双前缀病句「整理失败：操作失败：<原文>」。
// 裁定（最小归一）：已冠「操作失败：」开头者原样作 toast 文案；其余一律保持「整理失败：<msg>」
// 既有形态（含裸「操作失败」无冒号回落与空串——不发明新规则，只掐双前缀这一种病）。
// 空串产出「整理失败：」悬空冒号 = 现状原样（narrativeErrors/proposalErrors 的无冒号纪律
// 属于它们的入口，本函数刻意不复制）。

/** 外层 catch toast 文案：「操作失败：」前缀消息透传；其余叠「整理失败：」。 */
export function organizeFailureText(msg: string): string {
  return msg.startsWith('操作失败：') ? msg : `整理失败：${msg}`
}
