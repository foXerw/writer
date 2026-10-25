// plotline:* / choice:* / foreshadow:* IPC 层（Task 8，仅数据层——录入 UI 按 M1 裁定随 M4）：
// 13 个通道全部薄委托到 bookStore/narrative 仓库，本文件零文件系统直操（对齐 chapter/volume/character/setting 纪律）。
// 错误语义由仓库定义并原样透传：REF_BROKEN（本补丁新引入的幻影引用）/ *_MISSING /
// *_TITLE_INVALID / *_INVALID / BAD_*_ID / FORESHADOW_TRANSITION（非法状态转移）；delete 按幂等契约返回 false。
// create：seed 沿用 v1 手感默认（未命名剧情线/active、未命名选项），渲染层整张 Partial 经仓库 init
// 一次原子写落盘；update：整档写入，updatedAt 仓库侧刷新、createdAt 以存量为准。
// foreshadow 通道返回整本台账（单文件实体，转移后渲染层直接 setLedger，免二次 getAll 竞态）。
// Task 8 裁定：通道清单在 brief 的 get/upsert/resolve/abandon 之外补 foreshadow:reopen——
// 状态机的撤回边（resolved→open、abandoned→open）没有其他可达入口，缺它机就是死的。
import { ipcMain } from 'electron'
import type {
  ChoiceNodeV2,
  ForeshadowEntry,
  ForeshadowLedger,
  PlotlineV2
} from '../../../../src/common/schema'
import {
  abandonForeshadow,
  createChoice,
  createPlotline,
  deleteChoice,
  deletePlotline,
  listChoices,
  listPlotlines,
  readLedger,
  reopenForeshadow,
  resolveForeshadow,
  updateChoice,
  updatePlotline,
  upsertForeshadow
} from '../../bookStore/narrative'

export function registerNarrativeHandlers(): void {
  ipcMain.handle('plotline:getAll', (_e, projectPath: string): PlotlineV2[] =>
    listPlotlines(projectPath)
  )

  ipcMain.handle(
    'plotline:create',
    (_e, params: { projectPath: string; plotline: Partial<PlotlineV2> }): PlotlineV2 =>
      createPlotline(
        params.projectPath,
        {
          title: params.plotline.title ?? '未命名剧情线',
          summary: params.plotline.summary,
          status: params.plotline.status
        },
        params.plotline
      )
  )

  ipcMain.handle(
    'plotline:update',
    (_e, params: { projectPath: string; plotline: PlotlineV2 }): PlotlineV2 =>
      updatePlotline(params.projectPath, params.plotline)
  )

  ipcMain.handle(
    'plotline:delete',
    (_e, params: { projectPath: string; plotlineId: string }): boolean =>
      deletePlotline(params.projectPath, params.plotlineId)
  )

  ipcMain.handle('choice:getAll', (_e, projectPath: string): ChoiceNodeV2[] =>
    listChoices(projectPath)
  )

  ipcMain.handle(
    'choice:create',
    (_e, params: { projectPath: string; choice: Partial<ChoiceNodeV2> }): ChoiceNodeV2 =>
      createChoice(
        params.projectPath,
        {
          title: params.choice.title ?? '未命名选项',
          chapterId: params.choice.chapterId ?? ''
        },
        params.choice
      )
  )

  ipcMain.handle(
    'choice:update',
    (_e, params: { projectPath: string; choice: ChoiceNodeV2 }): ChoiceNodeV2 =>
      updateChoice(params.projectPath, params.choice)
  )

  ipcMain.handle(
    'choice:delete',
    (_e, params: { projectPath: string; choiceId: string }): boolean =>
      deleteChoice(params.projectPath, params.choiceId)
  )

  ipcMain.handle('foreshadow:get', (_e, projectPath: string): ForeshadowLedger =>
    readLedger(projectPath)
  )

  ipcMain.handle(
    'foreshadow:upsert',
    (_e, params: { projectPath: string; entry: ForeshadowEntry }): ForeshadowLedger =>
      upsertForeshadow(params.projectPath, params.entry)
  )

  ipcMain.handle(
    'foreshadow:resolve',
    (
      _e,
      params: { projectPath: string; foreshadowId: string; resolvedChapterId: string }
    ): ForeshadowLedger =>
      resolveForeshadow(params.projectPath, params.foreshadowId, params.resolvedChapterId)
  )

  ipcMain.handle(
    'foreshadow:abandon',
    (_e, params: { projectPath: string; foreshadowId: string }): ForeshadowLedger =>
      abandonForeshadow(params.projectPath, params.foreshadowId)
  )

  ipcMain.handle(
    'foreshadow:reopen',
    (_e, params: { projectPath: string; foreshadowId: string }): ForeshadowLedger =>
      reopenForeshadow(params.projectPath, params.foreshadowId)
  )
}
