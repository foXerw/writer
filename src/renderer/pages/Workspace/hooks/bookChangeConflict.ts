// Task 9 修订 ①：book:changed 冲突判定的纯逻辑（抽成纯函数供无 jsdom 单测，镜像 chapterRefresh.ts 先例）。
// 控制器修订：冲突必须「内容比对」判定，不能「事件触发」判定——本应用自己的写盘（自动保存/手动保存）
// 经 watcher 回声成 book:changed 事件，若按事件+dirty 开弹窗，连续打字期间每个自动保存周期都会误报
// 「文件被外部修改」。正确判定：磁盘真相（bypass 缓存点读）=== 会话最近一次保存/重载的内容（lastSaved）
// → 自写回声，静默忽略（不弹窗、不刷新抖动）；≠ → 真外部改动 → 冲突弹窗 + 暂停门。
// 本文件只做同步判定；磁盘点读（异步 IPC）与弹窗编排由调用方（Workspace）负责。

/** book:changed 的 paths 是否触及「当前章的文件」（chapters/<id>.md，正斜杠相对路径——watcher 契约）。 */
export function bookChangeTouchesCurrentChapter(
  paths: string[],
  currentChapterId: string | null
): boolean {
  return currentChapterId !== null && paths.includes(`chapters/${currentChapterId}.md`)
}

export type ConflictDecision = 'ignore-echo' | 'open-conflict-modal'

/**
 * 脏章文件被 book:changed 触及时的二值判定（两种结局都在 bookChangeConflict.test.ts 钉死）：
 * - diskContent === lastSavedContent → 'ignore-echo'：自写回声，静默忽略；
 * - 其余（不等 / diskContent=null 即章被外删或点读失败 / lastSaved=null 即基准缺失）→
 *   'open-conflict-modal'：宁可多问一次，绝不静默丢用户编辑。
 */
export function decideConflict(
  diskContent: string | null,
  lastSavedContent: string | null
): ConflictDecision {
  if (diskContent !== null && diskContent === lastSavedContent) return 'ignore-echo'
  return 'open-conflict-modal'
}
