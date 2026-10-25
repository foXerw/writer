import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NovelWriterApi } from '../../src/common/ipc'
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

  'dialog:openDirectory': () => ipcRenderer.invoke('dialog:openDirectory'),
  'dialog:openFile': (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  'dialog:saveFile': (params) => ipcRenderer.invoke('dialog:saveFile', params),

  'theme:set': (mode) => ipcRenderer.invoke('theme:set', mode),

  'stats:get': (projectPath) => ipcRenderer.invoke('stats:get', projectPath),
  'stats:save': (params) => ipcRenderer.invoke('stats:save', params),

  'export:word': (params) => ipcRenderer.invoke('export:word', params),
  'export:epub': (params) => ipcRenderer.invoke('export:epub', params),
  'export:pdf': (params) => ipcRenderer.invoke('export:pdf', params)
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
    moveToVolume: projectAPI['chapter:moveToVolume']
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

  // 监听器
  on: {
    projectCreated: rendererListeners['project:created'],
    projectOpened: rendererListeners['project:opened'],
    fileSaved: rendererListeners['file:saved'],
    statsUpdated: rendererListeners['stats:updated']
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
