// useEditorSession.loadChapters 的重同步纯逻辑（Task 5 评审整改第 3 条，抽成纯函数供无 jsdom 单测）。
// 旧语义：每次刷新 setOpenedChapters([data[0]]) + selectChapter(data[0])——树内任何一次
// 移卷/删卷/删章操作都会关掉所有 tab 并跳到第 1 章。M1 时这只是别扭，卷操作把它变成了
// 主流程（每次移卷必触发刷新）。新语义：
// - tab 布局保留：成员换成磁盘新鲜对象（同 id），被删者顺位掉出；
// - 当前章仍在列表 → 以新鲜对象重同步（编辑器是否回灌由调用方按 dirty 判定，此处不关心）；
// - 当前章被删 → 调用方接管（选剩余首 tab 或清空会话）；
// - 仅「从未自动打开过的空会话 + 盘上有章」才 autoOpenFirst（首载语义），
//   用户主动关光 tab 后的刷新不再强行开章。
import type { Chapter } from '@/common/ipc'

export interface RefreshInput {
  /** 刷新前的打开列表（tab 顺序） */
  opened: Chapter[]
  /** 当前编辑章 id（无则 null） */
  currentId: string | null
  /** 磁盘新鲜全量列表 */
  fresh: Chapter[]
  /** 本会话是否已发生过首载自动打开 */
  hasAutoOpened: boolean
}

export interface RefreshPlan {
  tabs: Chapter[]
  /** 当前章的新鲜对象；已被删/原本无当前章则 null */
  current: Chapter | null
  /** 会话空且从未自动打开且盘上有章：调用方应打开 fresh[0] */
  autoOpenFirst: boolean
}

export function planChapterRefresh({ opened, currentId, fresh, hasAutoOpened }: RefreshInput): RefreshPlan {
  const byId = new Map(fresh.map((c) => [c.id, c]))
  const tabs = opened
    .map((c) => byId.get(c.id))
    .filter((c): c is Chapter => c !== undefined)
  const current = currentId !== null ? byId.get(currentId) ?? null : null
  const autoOpenFirst =
    !hasAutoOpened && currentId === null && opened.length === 0 && fresh.length > 0
  return { tabs, current, autoOpenFirst }
}
