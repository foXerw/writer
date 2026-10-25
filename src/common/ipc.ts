// IPC通信类型定义

// 仅类型导入（双向 type-only 环：schema.ts 从这里取枚举类型，这里从 schema 取 CharacterV2——
// tsc/vite 编译期即擦除，无运行时循环依赖）。
import type { CharacterV2, WorldEntryV2 } from './schema'

// 主进程 -> 渲染进程 事件
export type MainToRendererEvents = {
  'project:created': (project: ProjectData) => void
  'project:opened': (project: ProjectData) => void
  'file:saved': (filePath: string) => void
  'stats:updated': (stats: WritingStats) => void
  'menu:event': (event: string, ...args: unknown[]) => void
}

// 渲染进程 -> 主进程 请求
export type RendererToMainRequests = {
  // 项目相关
  'project:create': (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
  'project:open': (path: string) => Promise<ProjectData>

  // 文件相关
  'file:read': (path: string) => Promise<string>
  'file:write': (params: { path: string; content: string }) => Promise<boolean>
  'file:delete': (path: string) => Promise<boolean>
  'file:exists': (path: string) => Promise<boolean>

  // 章节相关
  'chapter:getAll': (projectPath: string) => Promise<Chapter[]>
  'chapter:create': (params: {
    projectPath: string
    title: string
    // Task 5：新建章落在当前卷（未传/null = 未分卷）
    volumeId?: string | null
  }) => Promise<Chapter>
  // Task 5 评审整改：本通道只写编辑字段（title/content/status）；整 Chapter 里的
  // volumeId 会被 handler 忽略——归属唯一写通道 = chapter:moveToVolume
  'chapter:update': (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
  'chapter:delete': (params: { projectPath: string; chapterId: string }) => Promise<boolean>
  'chapter:rename': (params: { projectPath: string; chapterId: string; newTitle: string }) => Promise<Chapter>
  'chapter:reorder': (params: { projectPath: string; fromId: string; toId: string }) => Promise<boolean>
  'chapter:getById': (params: { projectPath: string; chapterId: string }) => Promise<Chapter | null>
  // 改卷归属（Task 5）：volumeId = null 或未传 → 未分卷；缺省绝不视同「不改归属」
  'chapter:moveToVolume': (params: {
    projectPath: string
    chapterId: string
    volumeId: string | null
  }) => Promise<Chapter>

  // 卷相关（Task 5 一等公民：volumes/<id>.yaml = VolumeDoc{id,title,order}）
  'volume:getAll': (projectPath: string) => Promise<Volume[]>
  'volume:create': (params: { projectPath: string; title: string }) => Promise<Volume>
  'volume:rename': (params: {
    projectPath: string
    volumeId: string
    newTitle: string
  }) => Promise<Volume>
  'volume:delete': (params: { projectPath: string; volumeId: string }) => Promise<boolean>
  'volume:reorder': (params: {
    projectPath: string
    fromId: string
    toId: string
  }) => Promise<boolean>

  // 角色相关（Task 6：v2 人物卡 CharacterV2——关系边按 id、时间戳 ISO 字符串；
  // 通道名不变，v1 Character 接口随仓库重写退役）
  'character:getAll': (projectPath: string) => Promise<CharacterV2[]>
  'character:getById': (params: { projectPath: string; characterId: string }) => Promise<CharacterV2 | null>
  'character:create': (params: { projectPath: string; character: Partial<CharacterV2> }) => Promise<CharacterV2>
  'character:update': (params: { projectPath: string; character: CharacterV2 }) => Promise<CharacterV2>
  'character:delete': (params: { projectPath: string; characterId: string }) => Promise<boolean>

  // 世界观设定相关（Task 7：v2 词条 WorldEntryV2——world/<类别>/<全id>.yaml，时间戳 ISO 字符串；
  // 通道名不变，v1 Setting 接口随仓库重写退役）
  'setting:getAll': (projectPath: string) => Promise<WorldEntryV2[]>
  'setting:getById': (params: { projectPath: string; settingId: string }) => Promise<WorldEntryV2 | null>
  'setting:create': (params: { projectPath: string; setting: Partial<WorldEntryV2> }) => Promise<WorldEntryV2>
  'setting:update': (params: { projectPath: string; setting: WorldEntryV2 }) => Promise<WorldEntryV2>
  'setting:delete': (params: { projectPath: string; settingId: string }) => Promise<boolean>

  // 系统相关
  'dialog:openDirectory': () => Promise<string | null>
  'dialog:openFile': (filters: FileFilter[]) => Promise<string | null>
  'dialog:saveFile': (params: { defaultPath: string; filters?: FileFilter[] }) => Promise<string | null>

  // 主题相关
  'theme:set': (mode: 'dark' | 'light') => Promise<boolean>

  // 写作统计相关
  'stats:get': (projectPath: string) => Promise<StatsData | null>
  'stats:save': (params: { projectPath: string; stats: StatsData }) => Promise<boolean>

  // 文档导出相关
  'export:word': (params: ExportParams) => Promise<boolean>
  'export:epub': (params: ExportParams) => Promise<boolean>
  'export:pdf': (params: ExportParams) => Promise<boolean>
}

// preload 暴露给渲染进程的统一 IPC 门面（window.novelWriter 的唯一类型）。
// 分组方法签名与上方 RendererToMainRequests 通道一一对应；旧的通用裸通道已移除。
export interface NovelWriterApi {
  project: {
    create: RendererToMainRequests['project:create']
    open: RendererToMainRequests['project:open']
  }
  file: {
    read: RendererToMainRequests['file:read']
    write: RendererToMainRequests['file:write']
    delete: RendererToMainRequests['file:delete']
    exists: RendererToMainRequests['file:exists']
  }
  chapter: {
    getAll: RendererToMainRequests['chapter:getAll']
    create: RendererToMainRequests['chapter:create']
    update: RendererToMainRequests['chapter:update']
    delete: RendererToMainRequests['chapter:delete']
    rename: RendererToMainRequests['chapter:rename']
    reorder: RendererToMainRequests['chapter:reorder']
    getById: RendererToMainRequests['chapter:getById']
    moveToVolume: RendererToMainRequests['chapter:moveToVolume']
  }
  volume: {
    getAll: RendererToMainRequests['volume:getAll']
    create: RendererToMainRequests['volume:create']
    rename: RendererToMainRequests['volume:rename']
    delete: RendererToMainRequests['volume:delete']
    reorder: RendererToMainRequests['volume:reorder']
  }
  character: {
    getAll: RendererToMainRequests['character:getAll']
    getById: RendererToMainRequests['character:getById']
    create: RendererToMainRequests['character:create']
    update: RendererToMainRequests['character:update']
    delete: RendererToMainRequests['character:delete']
  }
  setting: {
    getAll: RendererToMainRequests['setting:getAll']
    getById: RendererToMainRequests['setting:getById']
    create: RendererToMainRequests['setting:create']
    update: RendererToMainRequests['setting:update']
    delete: RendererToMainRequests['setting:delete']
  }
  dialog: {
    openDirectory: RendererToMainRequests['dialog:openDirectory']
    openFile: RendererToMainRequests['dialog:openFile']
    saveFile: RendererToMainRequests['dialog:saveFile']
  }
  theme: {
    set: RendererToMainRequests['theme:set']
  }
  stats: {
    get: RendererToMainRequests['stats:get']
    save: RendererToMainRequests['stats:save']
  }
  export: {
    word: RendererToMainRequests['export:word']
    epub: RendererToMainRequests['export:epub']
    pdf: RendererToMainRequests['export:pdf']
  }
  on: {
    projectCreated: (callback: (project: ProjectData) => void) => void
    projectOpened: (callback: (project: ProjectData) => void) => void
    fileSaved: (callback: (filePath: string) => void) => void
    statsUpdated: (callback: (stats: WritingStats) => void) => void
  }
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => () => void
  }
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
  // v1 -> v2 迁移报告（未迁移的旧项目为 undefined/null）
  migration?: MigrationReport | null
}

// v1 -> v2 迁移报告（备份位置与告警明细）
export interface MigrationReport {
  backupPath: string
  warnings: string[]
}

// 项目配置
export interface ProjectConfig {
  wordCountGoal: number
  dailyGoal: number
  autoSave: boolean
  autoSaveInterval: number
}

// 最近项目（lastOpened 为 ISO 字符串，便于 zustand persist 序列化；展示时用 dayjs 格式化）
export interface RecentProject {
  id: string
  name: string
  path: string
  lastOpened: string
}

// 章节
export interface Chapter {
  id: string
  title: string
  content: string
  // v2 卷归属（v1 旧数据无此字段，迁移时补 null）
  volumeId?: string | null
  order: number
  status: 'draft' | 'revising' | 'completed'
  wordCount: number
  createdAt: Date
  updatedAt: Date
}

// 卷（v2 一等公民实体；与 common/schema.ts 的 VolumeDoc 同形——依赖方向 schema→ipc 保持不变，
// 此处独立声明供渲染层/preload 消费，卷仓库返回 VolumeDoc 结构即兼容）
export interface Volume {
  id: string
  title: string
  order: number
}

// 写作统计
export interface WritingStats {
  dailyWordCount: number
  totalWordCount: number
  writingDuration: number
  streak: number
}

// 写作统计（按项目持久化模型）
export interface DayStat {
  words: number
  minutes: number
}
export interface StatsData {
  dailyHistory: Record<string, DayStat>  // 'YYYY-MM-DD' -> DayStat
}

// 导出参数（word/pdf/epub 主进程生成用）
export interface ExportParams {
  chapters: { title: string; content: string }[]
  projectName: string
  options: { addFrontMatter?: boolean; addToc?: boolean }
  savePath: string
}

// 文件过滤器
export interface FileFilter {
  name: string
  extensions: string[]
}

// 角色性别
export type CharacterGender = 'male' | 'female' | 'other'

// 角色定位
export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'minor'

// 角色标签（v2 CharacterV2.tags 沿用 v1 结构——其 id 历史上非 UUID，schema.ts 校验器有意豁免）
export interface CharacterTag {
  id: string
  name: string
  color?: string
}

// v1 Character / CharacterRelationship / CharacterCreateParams 已随 Task 6 人物卡 v2 仓库重写退役：
// 通道载荷类型统一为 schema.ts 的 CharacterV2（关系边 EntityLink 按 id 引用）。

// 世界观设定分类
export type SettingCategory = 'location' | 'history' | 'magic' | 'culture' | 'other'

// v1 Setting 已随 Task 7 世界观词条 v2 仓库重写退役：
// 通道载荷类型统一为 schema.ts 的 WorldEntryV2（parentId 世界层级、links 按 id 引用、时间戳 ISO 字符串）。
