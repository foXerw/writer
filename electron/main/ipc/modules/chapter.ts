// chapter:* IPC 层（Task 4 重写）：7 个通道全部薄委托到 bookStore/chapters 仓库，
// 通道名与入参形状不变；旧「文件名当数据」的字符串手术已全删（本文件零文件系统直操）。
// 错误语义由仓库定义并原样透传：CHAPTER_MISSING（update/rename 缺档）、FRONTMATTER_*（坏 front-matter）。
import { ipcMain } from 'electron'
import type { Chapter } from '../../../../src/common/ipc'
import {
  createChapter,
  deleteChapter,
  getChapter,
  listChapters,
  moveChapter,
  renameChapter,
  updateChapter
} from '../../bookStore/chapters'

export function registerChapterHandlers(): void {
  ipcMain.handle('chapter:getAll', (_e, projectPath: string) => listChapters(projectPath))

  ipcMain.handle(
    'chapter:create',
    (_e, params: { projectPath: string; title: string; volumeId?: string | null }) =>
      createChapter(params.projectPath, params.title, params.volumeId ?? null)
  )

  // 渲染层仍传整 Chapter 对象：只取正文编辑字段作 patch。
  // Task 5 评审整改：volumeId 一律不进 patch——脏章 flush 竞态下（移卷成功→列表重拉 resolve 前，
  // 切章/自动保存把携带陈旧 volumeId 的会话对象整章回写），本通道回写归属会静默撤销移卷、
  // 甚至在删卷后重新持久化指向已删卷的悬挂引用。归属唯一写通道 = chapter:moveToVolume；
  // applyPatch 对 undefined volumeId 本就不动，仓库零改动。
  ipcMain.handle('chapter:update', (_e, params: { projectPath: string; chapter: Chapter }) => {
    const { projectPath, chapter } = params
    return updateChapter(projectPath, chapter.id, {
      title: chapter.title,
      status: chapter.status,
      content: chapter.content
    })
  })

  ipcMain.handle('chapter:delete', (_e, params: { projectPath: string; chapterId: string }) =>
    deleteChapter(params.projectPath, params.chapterId)
  )

  ipcMain.handle(
    'chapter:rename',
    (_e, params: { projectPath: string; chapterId: string; newTitle: string }) =>
      renameChapter(params.projectPath, params.chapterId, params.newTitle)
  )

  // (fromId, toId) 语义 = 「把 from 移到 to 所在 order 位」：toId 经仓库映射为 order 后委托 moveChapter
  ipcMain.handle(
    'chapter:reorder',
    (_e, params: { projectPath: string; fromId: string; toId: string }) => {
      const to = listChapters(params.projectPath).find((c) => c.id === params.toId)
      return to ? moveChapter(params.projectPath, params.fromId, to.order) : false
    }
  )

  // bypassCache（Task 9 修订 ①）：冲突判定要的是此刻磁盘真相——透传给仓库跳过缓存正命中
  ipcMain.handle(
    'chapter:getById',
    (_e, params: { projectPath: string; chapterId: string; bypassCache?: boolean }) =>
      getChapter(params.projectPath, params.chapterId, { bypassCache: params.bypassCache })
  )
}
