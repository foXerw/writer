// volume:* IPC 层（Task 5）：5 个卷通道 + chapter:moveToVolume 全部薄委托到 bookStore/volumes 仓库，
// 本文件零文件系统直操、零字符串手术（对齐 modules/chapter.ts 纪律）。
// 参数形状沿用 chapter 组惯例 `{projectPath, ...}`；volumeId 缺省在 moveToVolume 归一为 null
// （= 未分卷），绝不视同「不改归属」——渲染层忘传不该静默保留旧卷。
// 错误语义由仓库定义并原样透传：VOLUME_MISSING / BAD_VOLUME_ID / VOLUME_TITLE_INVALID / CHAPTER_MISSING。
import { ipcMain } from 'electron'
import type { VolumeDoc } from '../../../../src/common/schema'
import {
  createVolume,
  deleteVolume,
  listVolumes,
  moveChapterToVolume,
  renameVolume,
  reorderVolumes
} from '../../bookStore/volumes'

export function registerVolumeHandlers(): void {
  ipcMain.handle('volume:getAll', (_e, projectPath: string): VolumeDoc[] =>
    listVolumes(projectPath)
  )

  ipcMain.handle(
    'volume:create',
    (_e, params: { projectPath: string; title: string }): VolumeDoc =>
      createVolume(params.projectPath, params.title)
  )

  ipcMain.handle(
    'volume:rename',
    (_e, params: { projectPath: string; volumeId: string; newTitle: string }): VolumeDoc =>
      renameVolume(params.projectPath, params.volumeId, params.newTitle)
  )

  ipcMain.handle(
    'volume:delete',
    (_e, params: { projectPath: string; volumeId: string }): boolean =>
      deleteVolume(params.projectPath, params.volumeId)
  )

  // (fromId, toId) 语义与 chapter:reorder 一致：把 from 移到 to 所在槽位，order 稠密重编
  ipcMain.handle(
    'volume:reorder',
    (_e, params: { projectPath: string; fromId: string; toId: string }): boolean =>
      reorderVolumes(params.projectPath, params.fromId, params.toId)
  )

  // 通道挂 chapter: 前缀（变更的是章节实体的归属），实现住卷仓库
  ipcMain.handle(
    'chapter:moveToVolume',
    (
      _e,
      params: { projectPath: string; chapterId: string; volumeId?: string | null }
    ): ReturnType<typeof moveChapterToVolume> =>
      moveChapterToVolume(params.projectPath, params.chapterId, params.volumeId ?? null)
  )
}
