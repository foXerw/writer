import { dialog, ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { Chapter, ProjectType } from '../../src/common/ipc'

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
    throw new Error('项目配置文件不存在')
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
