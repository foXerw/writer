import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { Character } from '../../../../src/common/ipc'

// ==================== 角色相关处理 ====================

// 获取角色目录路径
function getCharactersDir(projectPath: string): string {
  return path.join(projectPath, 'characters')
}

export function registerCharacterHandlers(): void {
  // 获取所有角色
  ipcMain.handle('character:getAll', async (_, projectPath: string) => {
    const charactersDir = getCharactersDir(projectPath)

    if (!fs.existsSync(charactersDir)) {
      return []
    }

    const files = fs.readdirSync(charactersDir)
      .filter(f => f.endsWith('.json'))

    return files.map(file => {
      const filePath = path.join(charactersDir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        return JSON.parse(content)
      } catch {
        return null
      }
    }).filter(Boolean)
  })

  // 获取单个角色
  ipcMain.handle('character:getById', async (_, params: { projectPath: string; characterId: string }) => {
    const { projectPath, characterId } = params
    const charactersDir = getCharactersDir(projectPath)
    const filePath = path.join(charactersDir, `${characterId}.json`)

    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  })

  // 创建角色
  ipcMain.handle('character:create', async (_, params: { projectPath: string; character: Partial<Character> }) => {
    const { projectPath, character } = params
    const charactersDir = getCharactersDir(projectPath)

    if (!fs.existsSync(charactersDir)) {
      fs.mkdirSync(charactersDir, { recursive: true })
    }

    const id = randomUUID()
    const newCharacter: Character = {
      id,
      name: character.name || '未命名角色',
      gender: character.gender || 'other',
      age: character.age || 0,
      role: character.role || 'supporting',
      avatar: character.avatar,
      appearance: character.appearance || '',
      personality: character.personality || '',
      background: character.background || '',
      goals: character.goals,
      flaws: character.flaws,
      relationships: character.relationships || [],
      tags: character.tags || [],
      notes: character.notes,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const filePath = path.join(charactersDir, `${id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(newCharacter, null, 2))

    return newCharacter
  })

  // 更新角色
  ipcMain.handle('character:update', async (_, params: { projectPath: string; character: Character }) => {
    const { projectPath, character } = params
    const charactersDir = getCharactersDir(projectPath)

    const updatedCharacter: Character = {
      ...character,
      updatedAt: new Date()
    }

    const filePath = path.join(charactersDir, `${character.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(updatedCharacter, null, 2))

    return updatedCharacter
  })

  // 删除角色
  ipcMain.handle('character:delete', async (_, params: { projectPath: string; characterId: string }) => {
    const { projectPath, characterId } = params
    const charactersDir = getCharactersDir(projectPath)
    const filePath = path.join(charactersDir, `${characterId}.json`)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    return true
  })
}
