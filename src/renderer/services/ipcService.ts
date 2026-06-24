// 渲染进程文件服务 - 封装IPC调用

import type { Chapter, ProjectData, RecentProject, FileFilter } from '../common/ipc'

// 调用主进程的IPC方法
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI.invoke(channel, ...args) as Promise<T>
}

// 发送事件到主进程
function send(channel: string, ...args: unknown[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electronAPI.send(channel, ...args)
}

// 监听主进程事件
function on<T>(channel: string, callback: (data: T) => void): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electronAPI.on(channel, (_event: unknown, data: T) => {
    callback(data)
  })
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).electronAPI.off(channel)
  }
}

// ==================== 项目相关 ====================

export interface ProjectCreateParams {
  name: string
  path: string
  type: 'novel' | 'script' | 'essay'
}

export async function createProject(params: ProjectCreateParams): Promise<ProjectData> {
  return invoke<ProjectData>('project:create', params)
}

export async function openProject(projectPath: string): Promise<ProjectData> {
  return invoke<ProjectData>('project:open', projectPath)
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  return invoke<RecentProject[]>('project:getRecent')
}

// ==================== 文件相关 ====================

export async function readFile(filePath: string): Promise<string> {
  return invoke<string>('file:read', filePath)
}

export async function writeFile(filePath: string, content: string): Promise<boolean> {
  return invoke<boolean>('file:write', { path: filePath, content })
}

export async function deleteFile(filePath: string): Promise<boolean> {
  return invoke<boolean>('file:delete', filePath)
}

export async function fileExists(filePath: string): Promise<boolean> {
  return invoke<boolean>('file:exists', filePath)
}

// ==================== 章节相关 ====================

export async function getAllChapters(projectPath: string): Promise<Chapter[]> {
  return invoke<Chapter[]>('chapter:getAll', projectPath)
}

export async function createChapter(projectPath: string, title: string): Promise<Chapter> {
  return invoke<Chapter>('chapter:create', { projectPath, title })
}

export async function updateChapter(projectPath: string, chapter: Chapter): Promise<Chapter> {
  return invoke<Chapter>('chapter:update', { projectPath, chapter })
}

export async function deleteChapter(projectPath: string, chapterId: string): Promise<boolean> {
  return invoke<boolean>('chapter:delete', { projectPath, chapterId })
}

export async function renameChapter(projectPath: string, chapterId: string, newTitle: string): Promise<Chapter> {
  return invoke<Chapter>('chapter:rename', { projectPath, chapterId, newTitle })
}

export async function reorderChapters(projectPath: string, fromId: string, toId: string): Promise<boolean> {
  return invoke<boolean>('chapter:reorder', { projectPath, fromId, toId })
}

export async function getChapterById(projectPath: string, chapterId: string): Promise<Chapter | null> {
  return invoke<Chapter | null>('chapter:getById', { projectPath, chapterId })
}

// ==================== 对话框相关 ====================

export async function openDirectoryDialog(): Promise<string | null> {
  return invoke<string | null>('dialog:openDirectory')
}

export async function openFileDialog(filters?: FileFilter[]): Promise<string | null> {
  return invoke<string | null>('dialog:openFile', filters)
}

export async function saveFileDialog(defaultPath: string): Promise<string | null> {
  return invoke<string | null>('dialog:saveFile', defaultPath)
}

// ==================== 事件监听 ====================

export function onProjectCreated(callback: (project: ProjectData) => void): () => void {
  return on<ProjectData>('project:created', callback)
}

export function onProjectOpened(callback: (project: ProjectData) => void): () => void {
  return on<ProjectData>('project:opened', callback)
}

export function onFileSaved(callback: (filePath: string) => void): () => void {
  return on<string>('file:saved', callback)
}

export function onStatsUpdated(callback: (stats: { dailyWordCount: number; totalWordCount: number }) => void): () => void {
  return on<{ dailyWordCount: number; totalWordCount: number }>('stats:updated', callback)
}

// ==================== 自动保存 ====================

interface AutoSaveOptions {
  interval: number
  onSave: () => string // 返回当前内容；调用方在内部决定是否真正写盘
}

let autoSaveTimer: ReturnType<typeof setInterval> | null = null
let lastContent: string = ''

export function startAutoSave(options: AutoSaveOptions): void {
  stopAutoSave()
  lastContent = ''
  autoSaveTimer = setInterval(() => {
    const currentContent = options.onSave()
    if (currentContent !== lastContent) {
      lastContent = currentContent
    }
  }, options.interval)
}

export function stopAutoSave(): void {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
    autoSaveTimer = null
  }
}

export function debouncedSave(content: string, delay: number, onSave: (c: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let savedContent = ''

  const save = () => {
    if (savedContent !== content) {
      savedContent = content
      onSave(content)
    }
  }

  timer = setTimeout(save, delay)

  return () => {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
