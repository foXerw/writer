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

  // 渲染层仍传整 Chapter 对象：取 id + 可改字段作 patch（volumeId 缺省 = 不改归属）
  ipcMain.handle('chapter:update', (_e, params: { projectPath: string; chapter: Chapter }) => {
    const { projectPath, chapter } = params
    return updateChapter(projectPath, chapter.id, {
      title: chapter.title,
      volumeId: chapter.volumeId,
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

  ipcMain.handle('chapter:getById', (_e, params: { projectPath: string; chapterId: string }) =>
    getChapter(params.projectPath, params.chapterId)
  )
}
