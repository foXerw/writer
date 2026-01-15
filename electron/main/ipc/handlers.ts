import { dialog, ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { Chapter, ProjectType, Character, Setting } from '../../src/common/ipc'

// 获取主窗口
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win
}

// 存储最近项目
const recentProjects: Map<string, { name: string; path: string; lastOpened: Date }> = new Map()

// 格式化文件路径
function formatFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

// 项目相关处理
ipcMain.handle('project:create', async (_, params: { name: string; path: string; type: ProjectType }) => {
  const { name, path: projectPath, type } = params
  const projectDir = path.join(projectPath, name)

  // 创建项目目录
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }

  // 创建项目配置
  const config = {
    name,
    type,
    version: '1.0.0',
    settings: {
      wordCountGoal: 0,
      dailyGoal: 2000,
      autoSave: true,
      autoSaveInterval: 30000
    }
  }

  fs.writeFileSync(
    path.join(projectDir, '.novelwriter.json'),
    JSON.stringify(config, null, 2)
  )

  // 创建章节目录
  fs.mkdirSync(path.join(projectDir, 'chapters'), { recursive: true })

  const projectData = {
    id: randomUUID(),
    name,
    path: formatFilePath(projectDir),
    type,
    createdAt: new Date(),
    updatedAt: new Date(),
    config: config.settings
  }

  // 添加到最近项目
  recentProjects.set(projectDir, { name, path: projectDir, lastOpened: new Date() })

  return projectData
})

ipcMain.handle('project:open', async (_, projectPath: string) => {
  const configPath = path.join(projectPath, '.novelwriter.json')

  if (!fs.existsSync(configPath)) {
    throw new Error('INVALID_PROJECT: Project configuration file not found. Please select a valid Novel Writer project folder.')
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  // 添加到最近项目
  recentProjects.set(projectPath, {
    name: config.name,
    path: projectPath,
    lastOpened: new Date()
  })

  return {
    id: randomUUID(),
    name: config.name,
    path: formatFilePath(projectPath),
    type: config.type,
    createdAt: new Date(),
    updatedAt: new Date(),
    config: config.settings
  }
})

ipcMain.handle('project:getRecent', async () => {
  return Array.from(recentProjects.values())
    .sort((a, b) => b.lastOpened.getTime() - a.lastOpened.getTime())
    .slice(0, 10)
})

// 文件相关处理
ipcMain.handle('file:read', async (_, filePath: string) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('文件不存在')
  }
  return fs.readFileSync(filePath, 'utf-8')
})

ipcMain.handle('file:write', async (_, params: { path: string; content: string }) => {
  try {
    fs.writeFileSync(params.path, params.content, 'utf-8')
    return true
  } catch (error) {
    console.error('文件写入失败:', error)
    return false
  }
})

ipcMain.handle('file:delete', async (_, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch (error) {
    console.error('文件删除失败:', error)
    return false
  }
})

ipcMain.handle('file:exists', async (_, filePath: string) => {
  return fs.existsSync(filePath)
})

// 章节相关处理
ipcMain.handle('chapter:getAll', async (_, projectPath: string) => {
  const chaptersDir = path.join(projectPath, 'chapters')

  if (!fs.existsSync(chaptersDir)) {
    return []
  }

  const files = fs.readdirSync(chaptersDir)
    .filter(f => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))

  return files.map((file, index) => {
    const filePath = path.join(chaptersDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')

    // 从内容中提取标题（第一个 # 开头的内容）
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1] : file.replace('.md', '')

    // 计算字数
    const wordCount = content.replace(/[#*`\[\]\(\)]/g, '').length

    return {
      id: file.replace('.md', ''),
      title,
      content,
      order: index + 1,
      status: 'draft' as const,
      wordCount,
      createdAt: new Date(fs.statSync(filePath).ctime),
      updatedAt: new Date(fs.statSync(filePath).mtime)
    }
  })
})

ipcMain.handle('chapter:create', async (_, params: { projectPath: string; title: string }) => {
  const { projectPath, title } = params
  const chaptersDir = path.join(projectPath, 'chapters')

  if (!fs.existsSync(chaptersDir)) {
    fs.mkdirSync(chaptersDir, { recursive: true })
  }

  // 获取现有章节数量
  const existingFiles = fs.readdirSync(chaptersDir).filter(f => f.endsWith('.md'))
  const order = existingFiles.length + 1
  const id = `${order.toString().padStart(3, '0')}-${title}`
  const fileName = `${id}.md`

  const content = `# ${title}\n\n`
  const filePath = path.join(chaptersDir, fileName)

  fs.writeFileSync(filePath, content, 'utf-8')

  return {
    id,
    title,
    content,
    order,
    status: 'draft' as const,
    wordCount: content.length,
    createdAt: new Date(),
    updatedAt: new Date()
  }
})

ipcMain.handle('chapter:update', async (_, params: { projectPath: string; chapter: Chapter }) => {
  const { projectPath, chapter } = params
  const chaptersDir = path.join(projectPath, 'chapters')
  const fileName = `${chapter.id}.md`
  const filePath = path.join(chaptersDir, fileName)

  fs.writeFileSync(filePath, chapter.content, 'utf-8')

  return {
    ...chapter,
    updatedAt: new Date()
  }
})

ipcMain.handle('chapter:delete', async (_, params: { projectPath: string; chapterId: string }) => {
  const { projectPath, chapterId } = params
  const chaptersDir = path.join(projectPath, 'chapters')
  const filePath = path.join(chaptersDir, `${chapterId}.md`)

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  return true
})

ipcMain.handle('chapter:rename', async (_, params: { projectPath: string; chapterId: string; newTitle: string }) => {
  const { projectPath, chapterId, newTitle } = params
  const chaptersDir = path.join(projectPath, 'chapters')
  const oldFilePath = path.join(chaptersDir, `${chapterId}.md`)

  if (!fs.existsSync(oldFilePath)) {
    throw new Error('章节文件不存在')
  }

  // 读取文件内容
  const content = fs.readFileSync(oldFilePath, 'utf-8')
  // 更新第一行的标题
  const lines = content.split('\n')
  if (lines.length > 0) {
    lines[0] = `# ${newTitle}`
  }
  const newContent = lines.join('\n')

  // 如果ID也变了，需要重命名文件
  const newId = `${chapterId.split('-')[0]}-${newTitle}`
  const newFilePath = path.join(chaptersDir, `${newId}.md`)

  fs.writeFileSync(newFilePath, newContent, 'utf-8')

  // 如果ID变了，删除旧文件
  if (newId !== chapterId) {
    fs.unlinkSync(oldFilePath)
  }

  return {
    id: newId,
    title: newTitle,
    content: newContent,
    order: parseInt(chapterId.split('-')[0]) || 0,
    status: 'draft' as const,
    wordCount: newContent.length,
    createdAt: new Date(),
    updatedAt: new Date()
  }
})

ipcMain.handle('chapter:reorder', async (_, params: { projectPath: string; fromId: string; toId: string }) => {
  const { projectPath, fromId, toId } = params
  const chaptersDir = path.join(projectPath, 'chapters')

  if (!fs.existsSync(chaptersDir)) {
    return false
  }

  const files = fs.readdirSync(chaptersDir)
    .filter(f => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))

  const fromIndex = files.findIndex(f => f.replace('.md', '') === fromId)
  const toIndex = files.findIndex(f => f.replace('.md', '') === toId)

  if (fromIndex === -1 || toIndex === -1) {
    return false
  }

  // 交换文件顺序
  const [removed] = files.splice(fromIndex, 1)
  files.splice(toIndex, 0, removed)

  // 重命名文件以反映新顺序
  files.forEach((file, index) => {
    const oldPath = path.join(chaptersDir, file)
    const newName = `${(index + 1).toString().padStart(3, '0')}-${file.split('-').slice(1).join('-')}`
    const newPath = path.join(chaptersDir, newName)
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath)
    }
  })

  return true
})

ipcMain.handle('chapter:getById', async (_, params: { projectPath: string; chapterId: string }) => {
  const { projectPath, chapterId } = params
  const chaptersDir = path.join(projectPath, 'chapters')

  // 查找匹配的文件
  const files = fs.readdirSync(chaptersDir)
    .filter(f => f.endsWith('.md'))

  const file = files.find(f => {
    const id = f.replace('.md', '')
    return id === chapterId || id.startsWith(chapterId.split('-')[0])
  })

  if (!file) {
    return null
  }

  const filePath = path.join(chaptersDir, file)
  const content = fs.readFileSync(filePath, 'utf-8')

  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1] : file.replace('.md', '')

  const wordCount = content.replace(/[#*`\[\]\(\)]/g, '').length

  return {
    id: file.replace('.md', ''),
    title,
    content,
    order: parseInt(file.split('-')[0]) || 0,
    status: 'draft' as const,
    wordCount,
    createdAt: new Date(fs.statSync(filePath).ctime),
    updatedAt: new Date(fs.statSync(filePath).mtime)
  }
})

// 系统对话框
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('dialog:openFile', async (_, filters: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (_, defaultPath: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  return result.filePath
})

// ==================== 角色相关处理 ====================

// 获取角色目录路径
function getCharactersDir(projectPath: string): string {
  return path.join(projectPath, 'characters')
}

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

// ==================== 世界观设定相关处理 ====================

// 获取设定目录路径
function getSettingsDir(projectPath: string): string {
  return path.join(projectPath, 'settings')
}

// 获取所有设定
ipcMain.handle('setting:getAll', async (_, projectPath: string) => {
  const settingsDir = getSettingsDir(projectPath)

  if (!fs.existsSync(settingsDir)) {
    return []
  }

  // 递归读取所有JSON文件
  const readSettingsRecursive = (dir: string): Setting[] => {
    const results: Setting[] = []
    if (!fs.existsSync(dir)) return results

    const files = fs.readdirSync(dir)
    files.forEach(file => {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        results.push(...readSettingsRecursive(filePath))
      } else if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const setting = JSON.parse(content)
          // 计算相对路径作为parentId
          const relativePath = path.relative(settingsDir, filePath)
          setting.parentId = path.dirname(relativePath) === '.' ? undefined : path.dirname(relativePath)
          results.push(setting)
        } catch {
          // 忽略解析错误
        }
      }
    })

    return results
  }

  return readSettingsRecursive(settingsDir)
})

// 获取单个设定
ipcMain.handle('setting:getById', async (_, params: { projectPath: string; settingId: string }) => {
  const { projectPath, settingId } = params
  const settingsDir = getSettingsDir(projectPath)

  // 查找文件
  const findSetting = (dir: string): Setting | null => {
    if (!fs.existsSync(dir)) return null

    const files = fs.readdirSync(dir)
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        const found = findSetting(filePath)
        if (found) return found
      } else if (file.endsWith('.json') && file.replace('.json', '') === settingId) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          return JSON.parse(content)
        } catch {
          return null
        }
      }
    }

    return null
  }

  return findSetting(settingsDir)
})

// 创建设定
ipcMain.handle('setting:create', async (_, params: { projectPath: string; setting: Partial<Setting> }) => {
  const { projectPath, setting } = params
  const settingsDir = getSettingsDir(projectPath)

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true })
  }

  const id = randomUUID()
  const category = setting.category || 'other'

  // 根据分类创建子目录
  const categoryDir = path.join(settingsDir, category)
  if (!fs.existsSync(categoryDir)) {
    fs.mkdirSync(categoryDir, { recursive: true })
  }

  const newSetting: Setting = {
    id,
    title: setting.title || '未命名设定',
    category,
    content: setting.content || '',
    parentId: setting.parentId,
    order: setting.order || 0,
    tags: setting.tags || [],
    createdAt: new Date(),
    updatedAt: new Date()
  }

  const fileName = `${id}-${newSetting.title}.json`.replace(/[^a-zA-Z0-9\-_\.]/g, '_')
  const filePath = path.join(categoryDir, fileName)
  fs.writeFileSync(filePath, JSON.stringify(newSetting, null, 2))

  return newSetting
})

// 更新设定
ipcMain.handle('setting:update', async (_, params: { projectPath: string; setting: Setting }) => {
  const { projectPath, setting } = params
  const settingsDir = getSettingsDir(projectPath)

  const updatedSetting: Setting = {
    ...setting,
    updatedAt: new Date()
  }

  // 根据分类和ID查找并更新文件
  const findAndUpdate = (dir: string): boolean => {
    if (!fs.existsSync(dir)) return false

    const files = fs.readdirSync(dir)
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        if (findAndUpdate(filePath)) return true
      } else if (file.endsWith('.json') && file.startsWith(setting.id.substring(0, 8))) {
        fs.writeFileSync(filePath, JSON.stringify(updatedSetting, null, 2))
        return true
      }
    }

    return false
  }

  findAndUpdate(settingsDir)

  return updatedSetting
})

// 删除设定
ipcMain.handle('setting:delete', async (_, params: { projectPath: string; settingId: string }) => {
  const { projectPath, settingId } = params
  const settingsDir = getSettingsDir(projectPath)

  // 查找并删除文件
  const findAndDelete = (dir: string): boolean => {
    if (!fs.existsSync(dir)) return false

    const files = fs.readdirSync(dir)
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        if (findAndDelete(filePath)) return true
      } else if (file.endsWith('.json') && file.startsWith(settingId.substring(0, 8))) {
        fs.unlinkSync(filePath)
        return true
      }
    }

    return false
  }

  findAndDelete(settingsDir)

  return true
})
