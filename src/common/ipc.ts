// IPC通信类型定义

// 主进程 -> 渲染进程 事件
export type MainToRendererEvents = {
  'project:created': (project: ProjectData) => void
  'project:opened': (project: ProjectData) => void
  'file:saved': (filePath: string) => void
  'stats:updated': (stats: WritingStats) => void
}

// 渲染进程 -> 主进程 请求
export type RendererToMainRequests = {
  // 项目相关
  'project:create': (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
  'project:open': (path: string) => Promise<ProjectData>
  'project:getRecent': () => Promise<RecentProject[]>

  // 文件相关
  'file:read': (path: string) => Promise<string>
  'file:write': (params: { path: string; content: string }) => Promise<boolean>
  'file:delete': (path: string) => Promise<boolean>
  'file:exists': (path: string) => Promise<boolean>

  // 章节相关
  'chapter:getAll': (projectPath: string) => Promise<Chapter[]>
  'chapter:create': (params: { projectPath: string; title: string }) => Promise<Chapter>
  'chapter:update': (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
  'chapter:delete': (params: { projectPath: string; chapterId: string }) => Promise<boolean>

  // 系统相关
  'dialog:openDirectory': () => Promise<string | null>
  'dialog:openFile': (filters: FileFilter[]) => Promise<string | null>
  'dialog:saveFile': (defaultPath: string) => Promise<string | null>
}

// 项目类型
export type ProjectType = 'novel' | 'script' | 'essay'

// 项目数据
export interface ProjectData {
  id: string
  name: string
  path: string
  type: ProjectType
  createdAt: Date
  updatedAt: Date
  config: ProjectConfig
}

// 项目配置
export interface ProjectConfig {
  wordCountGoal: number
  dailyGoal: number
  autoSave: boolean
  autoSaveInterval: number
}

// 最近项目
export interface RecentProject {
  id: string
  name: string
  path: string
  lastOpened: Date
}

// 章节
export interface Chapter {
  id: string
  title: string
  content: string
  order: number
  status: 'draft' | 'revising' | 'completed'
  wordCount: number
  createdAt: Date
  updatedAt: Date
}

// 写作统计
export interface WritingStats {
  dailyWordCount: number
  totalWordCount: number
  writingDuration: number
  streak: number
}

// 文件过滤器
export interface FileFilter {
  name: string
  extensions: string[]
}
