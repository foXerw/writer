// character:* IPC 层（Task 6 重写）：5 个通道全部薄委托到 bookStore/characters v2 人物卡仓库，
// 本文件零文件系统直操（v1 的 *.json 裸读写全删）、通道名与参数形状不变（对齐 chapter/volume 纪律）。
// 错误语义由仓库定义并原样透传：REF_BROKEN（本补丁新引入的幻影引用）/ CHARACTER_MISSING /
// CHARACTER_NAME_INVALID / CHARACTER_INVALID / BAD_CHARACTER_ID；delete 按幂等契约返回 false。
// create：seed 三字段沿用 v1 手感默认（未命名角色/other/supporting），渲染层整张 Partial 经
// 仓库 init 一次原子写落盘；update：整卡写入，updatedAt 仓库侧刷新、createdAt 以存量为准。
import { ipcMain } from 'electron'
import type { CharacterV2 } from '../../../../src/common/schema'
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter
} from '../../bookStore/characters'

export function registerCharacterHandlers(): void {
  ipcMain.handle('character:getAll', (_e, projectPath: string): CharacterV2[] =>
    listCharacters(projectPath)
  )

  ipcMain.handle('character:getById', (_e, params: { projectPath: string; characterId: string }) =>
    getCharacter(params.projectPath, params.characterId)
  )

  ipcMain.handle(
    'character:create',
    (_e, params: { projectPath: string; character: Partial<CharacterV2> }): CharacterV2 =>
      createCharacter(
        params.projectPath,
        {
          name: params.character.name ?? '未命名角色',
          gender: params.character.gender ?? 'other',
          role: params.character.role ?? 'supporting'
        },
        params.character
      )
  )

  ipcMain.handle(
    'character:update',
    (_e, params: { projectPath: string; character: CharacterV2 }): CharacterV2 =>
      updateCharacter(params.projectPath, params.character)
  )

  ipcMain.handle(
    'character:delete',
    (_e, params: { projectPath: string; characterId: string }): boolean =>
      deleteCharacter(params.projectPath, params.characterId)
  )
}
