// setting:* IPC 层（Task 7 重写）：5 个通道全部薄委托到 bookStore/world v2 词条仓库，
// 本文件零文件系统直操（v1 的 settings/*.json 裸读写、递归查找与「文件名前 8 位定位」手术全删）、
// 通道名与参数形状不变（对齐 chapter/volume/character 纪律）。
// 错误语义由仓库定义并原样透传：REF_BROKEN（本补丁新引入的幻影 parentId/link）/ WORLD_MISSING /
// WORLD_TITLE_INVALID / WORLD_INVALID / BAD_WORLD_ID；delete 按幂等契约返回 false。
// create：seed 沿用 v1 手感默认（未命名设定/other/空正文），渲染层整张 Partial 经仓库 init 一次原子写落盘；
// update：整条目写入，category 改变由仓库负责分类目录搬迁，updatedAt 仓库侧刷新、createdAt 以存量为准。
import { ipcMain } from 'electron'
import type { WorldEntryV2 } from '../../../../src/common/schema'
import {
  createWorldEntry,
  deleteWorldEntry,
  getWorldEntry,
  listWorldEntries,
  updateWorldEntry
} from '../../bookStore/world'

export function registerSettingHandlers(): void {
  ipcMain.handle('setting:getAll', (_e, projectPath: string): WorldEntryV2[] =>
    listWorldEntries(projectPath)
  )

  ipcMain.handle('setting:getById', (_e, params: { projectPath: string; settingId: string }) =>
    getWorldEntry(params.projectPath, params.settingId)
  )

  ipcMain.handle(
    'setting:create',
    (_e, params: { projectPath: string; setting: Partial<WorldEntryV2> }): WorldEntryV2 =>
      createWorldEntry(
        params.projectPath,
        {
          title: params.setting.title ?? '未命名设定',
          category: params.setting.category ?? 'other',
          content: params.setting.content ?? ''
        },
        params.setting
      )
  )

  ipcMain.handle(
    'setting:update',
    (_e, params: { projectPath: string; setting: WorldEntryV2 }): WorldEntryV2 =>
      updateWorldEntry(params.projectPath, params.setting)
  )

  ipcMain.handle(
    'setting:delete',
    (_e, params: { projectPath: string; settingId: string }): boolean =>
      deleteWorldEntry(params.projectPath, params.settingId)
  )
}
