import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiChunkEvent, AiDoneEvent, AiErrorEvent } from '../../src/common/ai-types'
import type { BookChangedEvent, NovelWriterApi } from '../../src/common/ipc'
import {
  RendererToMainRequests,
  ProjectData,
  WritingStats
} from '../../src/common/ipc'

// 渲染进程 -> 主进程 请求（每条通道一个函数，与 handlers.ts 的参数形状一一对应）
const projectAPI: RendererToMainRequests = {
  'project:create': (params) => ipcRenderer.invoke('project:create', params),
  'project:open': (path) => ipcRenderer.invoke('project:open', path),

  'file:read': (path) => ipcRenderer.invoke('file:read', path),
  'file:write': (params) => ipcRenderer.invoke('file:write', params),
  'file:delete': (path) => ipcRenderer.invoke('file:delete', path),
  'file:exists': (path) => ipcRenderer.invoke('file:exists', path),

  'chapter:getAll': (projectPath) => ipcRenderer.invoke('chapter:getAll', projectPath),
  'chapter:create': (params) => ipcRenderer.invoke('chapter:create', params),
  'chapter:update': (params) => ipcRenderer.invoke('chapter:update', params),
  'chapter:delete': (params) => ipcRenderer.invoke('chapter:delete', params),
  'chapter:rename': (params) => ipcRenderer.invoke('chapter:rename', params),
  'chapter:reorder': (params) => ipcRenderer.invoke('chapter:reorder', params),
  'chapter:getById': (params) => ipcRenderer.invoke('chapter:getById', params),
  'chapter:moveToVolume': (params) => ipcRenderer.invoke('chapter:moveToVolume', params),
  'chapter:rebuild': (params) => ipcRenderer.invoke('chapter:rebuild', params),

  'volume:getAll': (projectPath) => ipcRenderer.invoke('volume:getAll', projectPath),
  'volume:create': (params) => ipcRenderer.invoke('volume:create', params),
  'volume:rename': (params) => ipcRenderer.invoke('volume:rename', params),
  'volume:delete': (params) => ipcRenderer.invoke('volume:delete', params),
  'volume:reorder': (params) => ipcRenderer.invoke('volume:reorder', params),

  'character:getAll': (projectPath) => ipcRenderer.invoke('character:getAll', projectPath),
  'character:getById': (params) => ipcRenderer.invoke('character:getById', params),
  'character:create': (params) => ipcRenderer.invoke('character:create', params),
  'character:update': (params) => ipcRenderer.invoke('character:update', params),
  'character:delete': (params) => ipcRenderer.invoke('character:delete', params),

  'setting:getAll': (projectPath) => ipcRenderer.invoke('setting:getAll', projectPath),
  'setting:getById': (params) => ipcRenderer.invoke('setting:getById', params),
  'setting:create': (params) => ipcRenderer.invoke('setting:create', params),
  'setting:update': (params) => ipcRenderer.invoke('setting:update', params),
  'setting:delete': (params) => ipcRenderer.invoke('setting:delete', params),

  'plotline:getAll': (projectPath) => ipcRenderer.invoke('plotline:getAll', projectPath),
  'plotline:create': (params) => ipcRenderer.invoke('plotline:create', params),
  'plotline:update': (params) => ipcRenderer.invoke('plotline:update', params),
  'plotline:delete': (params) => ipcRenderer.invoke('plotline:delete', params),

  'choice:getAll': (projectPath) => ipcRenderer.invoke('choice:getAll', projectPath),
  'choice:create': (params) => ipcRenderer.invoke('choice:create', params),
  'choice:update': (params) => ipcRenderer.invoke('choice:update', params),
  'choice:delete': (params) => ipcRenderer.invoke('choice:delete', params),

  'foreshadow:get': (projectPath) => ipcRenderer.invoke('foreshadow:get', projectPath),
  'foreshadow:upsert': (params) => ipcRenderer.invoke('foreshadow:upsert', params),
  'foreshadow:resolve': (params) => ipcRenderer.invoke('foreshadow:resolve', params),
  'foreshadow:abandon': (params) => ipcRenderer.invoke('foreshadow:abandon', params),
  'foreshadow:reopen': (params) => ipcRenderer.invoke('foreshadow:reopen', params),

  // AI 整理提案（M4b Task 3；参数一律 {projectPath, …} 对象形状）
  'proposal:getAll': (params) => ipcRenderer.invoke('proposal:getAll', params),
  'proposal:get': (params) => ipcRenderer.invoke('proposal:get', params),
  'proposal:save': (params) => ipcRenderer.invoke('proposal:save', params),
  'proposal:adopt': (params) => ipcRenderer.invoke('proposal:adopt', params),
  'proposal:reject': (params) => ipcRenderer.invoke('proposal:reject', params),

  'dialog:openDirectory': () => ipcRenderer.invoke('dialog:openDirectory'),
  'dialog:openFile': (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  'dialog:saveFile': (params) => ipcRenderer.invoke('dialog:saveFile', params),

  'theme:set': (mode) => ipcRenderer.invoke('theme:set', mode),

  'stats:get': (projectPath) => ipcRenderer.invoke('stats:get', projectPath),
  'stats:save': (params) => ipcRenderer.invoke('stats:save', params),

  'export:word': (params) => ipcRenderer.invoke('export:word', params),
  'export:epub': (params) => ipcRenderer.invoke('export:epub', params),
  'export:pdf': (params) => ipcRenderer.invoke('export:pdf', params),

  // AI 设置（M4a Task 2；返回形状永远是掩码视图，明文 apiKey 不经过此通道）
  'ai:getSettings': () => ipcRenderer.invoke('ai:getSettings'),
  'ai:setSettings': (patch) => ipcRenderer.invoke('ai:setSettings', patch),
  'ai:testConnection': () => ipcRenderer.invoke('ai:testConnection'),
  // AI 对话（M4a Task 4）：chat 只回「已受理」，结果走下面三个事件通道（契约见 src/common/ipc.ts）
  'ai:chat': (request) => ipcRenderer.invoke('ai:chat', request),
  'ai:cancel': (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
  'ai:getUsage': (projectPath) => ipcRenderer.invoke('ai:getUsage', projectPath)
}

// 主进程 -> 渲染进程 监听
const rendererListeners: {
  'project:created': (callback: (project: ProjectData) => void) => void
  'project:opened': (callback: (project: ProjectData) => void) => void
  'file:saved': (callback: (filePath: string) => void) => void
  'stats:updated': (callback: (stats: WritingStats) => void) => void
} = {
  'project:created': (callback) => ipcRenderer.on('project:created', (_, data) => callback(data)),
  'project:opened': (callback) => ipcRenderer.on('project:opened', (_, data) => callback(data)),
  'file:saved': (callback) => ipcRenderer.on('file:saved', (_, path) => callback(path)),
  'stats:updated': (callback) => ipcRenderer.on('stats:updated', (_, stats) => callback(stats))
}

// 唯一 IPC 门面：类型由 src/common/ipc.ts 的 NovelWriterApi 集中定义
const novelWriter: NovelWriterApi = {
  // 项目相关
  project: {
    create: projectAPI['project:create'],
    open: projectAPI['project:open']
  },

  // 文件相关
  file: {
    read: projectAPI['file:read'],
    write: projectAPI['file:write'],
    delete: projectAPI['file:delete'],
    exists: projectAPI['file:exists']
  },

  // 章节相关
  chapter: {
    getAll: projectAPI['chapter:getAll'],
    create: projectAPI['chapter:create'],
    update: projectAPI['chapter:update'],
    delete: projectAPI['chapter:delete'],
    rename: projectAPI['chapter:rename'],
    reorder: projectAPI['chapter:reorder'],
    getById: projectAPI['chapter:getById'],
    moveToVolume: projectAPI['chapter:moveToVolume'],
    rebuild: projectAPI['chapter:rebuild']
  },

  // 卷相关
  volume: {
    getAll: projectAPI['volume:getAll'],
    create: projectAPI['volume:create'],
    rename: projectAPI['volume:rename'],
    delete: projectAPI['volume:delete'],
    reorder: projectAPI['volume:reorder']
  },

  // 角色相关
  character: {
    getAll: projectAPI['character:getAll'],
    getById: projectAPI['character:getById'],
    create: projectAPI['character:create'],
    update: projectAPI['character:update'],
    delete: projectAPI['character:delete']
  },

  // 设定相关
  setting: {
    getAll: projectAPI['setting:getAll'],
    getById: projectAPI['setting:getById'],
    create: projectAPI['setting:create'],
    update: projectAPI['setting:update'],
    delete: projectAPI['setting:delete']
  },

  // 剧情线相关（Task 8，纯数据层）
  plotline: {
    getAll: projectAPI['plotline:getAll'],
    create: projectAPI['plotline:create'],
    update: projectAPI['plotline:update'],
    delete: projectAPI['plotline:delete']
  },

  // 关键选项相关（Task 8，纯数据层）
  choice: {
    getAll: projectAPI['choice:getAll'],
    create: projectAPI['choice:create'],
    update: projectAPI['choice:update'],
    delete: projectAPI['choice:delete']
  },

  // 伏笔台账相关（Task 8；转移通道返回整本新台账）
  foreshadow: {
    get: projectAPI['foreshadow:get'],
    upsert: projectAPI['foreshadow:upsert'],
    resolve: projectAPI['foreshadow:resolve'],
    abandon: projectAPI['foreshadow:abandon'],
    reopen: projectAPI['foreshadow:reopen']
  },

  // AI 整理提案（M4b Task 3）
  proposal: {
    getAll: projectAPI['proposal:getAll'],
    get: projectAPI['proposal:get'],
    save: projectAPI['proposal:save'],
    adopt: projectAPI['proposal:adopt'],
    reject: projectAPI['proposal:reject']
  },

  // 对话框
  dialog: {
    openDirectory: projectAPI['dialog:openDirectory'],
    openFile: projectAPI['dialog:openFile'],
    saveFile: projectAPI['dialog:saveFile']
  },

  // 主题
  theme: {
    set: projectAPI['theme:set']
  },

  // 写作统计
  stats: {
    get: projectAPI['stats:get'],
    save: projectAPI['stats:save']
  },

  // 文档导出
  export: {
    word: projectAPI['export:word'],
    epub: projectAPI['export:epub'],
    pdf: projectAPI['export:pdf']
  },

  // AI 设置 + 对话（M4a Task 2/4）
  ai: {
    getSettings: projectAPI['ai:getSettings'],
    setSettings: projectAPI['ai:setSettings'],
    testConnection: projectAPI['ai:testConnection'],
    chat: projectAPI['ai:chat'],
    cancel: projectAPI['ai:cancel'],
    getUsage: projectAPI['ai:getUsage']
  },

  // 监听器
  on: {
    projectCreated: rendererListeners['project:created'],
    projectOpened: rendererListeners['project:opened'],
    fileSaved: rendererListeners['file:saved'],
    statsUpdated: rendererListeners['stats:updated'],
    // Task 9：book:changed 订阅返回反订阅函数（镜像 menu.onEvent 先例——removeListener
    // 精确摘除本次注册的监听，绝不用 removeAllListeners 误伤其他订阅者）
    bookChanged: (handler: (event: BookChangedEvent) => void) => {
      const listener = (_e: IpcRendererEvent, event: BookChangedEvent): void => handler(event)
      ipcRenderer.on('book:changed', listener)
      return () => {
        ipcRenderer.removeListener('book:changed', listener)
      }
    },
    // Task 4：AI 流式事件三通道——与 bookChanged 逐字同纪律（包装函数入队、
    // removeListener 精确摘除自己的那一个；绝不用 removeAllListeners）
    aiChunk: (handler: (event: AiChunkEvent) => void) => {
      const listener = (_e: IpcRendererEvent, event: AiChunkEvent): void => handler(event)
      ipcRenderer.on('ai:chunk', listener)
      return () => {
        ipcRenderer.removeListener('ai:chunk', listener)
      }
    },
    aiDone: (handler: (event: AiDoneEvent) => void) => {
      const listener = (_e: IpcRendererEvent, event: AiDoneEvent): void => handler(event)
      ipcRenderer.on('ai:done', listener)
      return () => {
        ipcRenderer.removeListener('ai:done', listener)
      }
    },
    aiError: (handler: (event: AiErrorEvent) => void) => {
      const listener = (_e: IpcRendererEvent, event: AiErrorEvent): void => handler(event)
      ipcRenderer.on('ai:error', listener)
      return () => {
        ipcRenderer.removeListener('ai:error', listener)
      }
    }
  },

  // 菜单事件
  menu: {
    onEvent: (handler: (event: string, ...args: unknown[]) => void) => {
      const listener = (_e: IpcRendererEvent, event: string, ...args: unknown[]) => handler(event, ...args)
      ipcRenderer.on('menu:event', listener)
      return () => {
        ipcRenderer.removeListener('menu:event', listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('novelWriter', novelWriter)

declare global {
  interface Window {
    novelWriter: NovelWriterApi
  }
}
