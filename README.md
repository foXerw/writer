# Novel Writer - 专业作家应用

一个参考VSCode风格的专业小说写作应用，支持长篇创作、角色管理、世界观设定等功能。

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React 18+** - 前端UI框架
- **TypeScript** - 类型安全
- **Vite 5** - 快速构建工具
- **Monaco Editor** - VSCode同款编辑器内核
- **本地文件存储** - 项目数据以 JSON 配置 + Markdown 文件保存，通过 IPC 读写（无数据库依赖）
- **Zustand** - 轻量状态管理
- **Ant Design 5** - UI组件库

## 项目特点

### VSCode风格界面
- 命令面板 (Ctrl+Shift+P)
- 多文档Tab管理
- 可折叠侧边栏
- 状态栏实时统计
- 键盘优先操作

### 创作工具
- **章节管理**: 树状结构组织章节
- **角色卡片**: 完整角色档案系统
- **世界观设定**: 地理、历史、魔法体系
- **情节追踪**: 主线支线时间线
- **灵感笔记**: 随手记录创作片段

### 写作增强
- **专注模式**: 隐藏干扰元素
- **打字机模式**: 光标居中显示
- **自动保存**: 防止内容丢失
- **版本历史**: 追溯修改记录

### 数据统计
- 字数/词数统计
- 写作时长追踪
- 目标进度管理
- 效率分析报告

## 项目结构

```
novel-writer/
├── electron/
│   ├── main/
│   │   ├── index.ts              # 主进程入口
│   │   ├── window.ts             # 窗口管理（BrowserWindow）
│   │   ├── menu.ts               # 应用菜单
│   │   ├── tray.ts               # 系统托盘
│   │   └── ipc/
│   │       └── handlers.ts       # IPC 处理（项目/文件/章节/角色/设定）
│   └── preload/
│       └── index.ts              # 预加载脚本（contextBridge 暴露 IPC）
├── src/
│   ├── common/
│   │   └── ipc.ts                # IPC 类型定义与通道常量
│   └── renderer/
│       ├── App.tsx               # 应用根组件
│       ├── index.tsx             # 渲染进程入口
│       ├── index.html            # HTML 模板
│       ├── components/            # React 组件
│       │   ├── Layout/           # 布局（EditorTabs）
│       │   ├── Editor/           # 编辑器（MonacoEditor / EditorToolbar / OutlineView）
│       │   ├── Explorer/         # 侧边面板（ChapterTree / CharacterPanel / SettingPanel / StatsPanel）
│       │   ├── Dialogs/          # 对话框（CommandPalette / ExportDialog / ProjectDialog）
│       │   └── Settings/         # 设置（ThemeSettings）
│       ├── pages/                # 页面（Home / Workspace / Settings）
│       ├── stores/               # 状态管理（Zustand）
│       ├── hooks/                # 自定义钩子（useIPC / useKeyboard / useMenu）
│       ├── services/             # 前端服务（fileService / ipcService）
│       └── styles/              # 样式（global.css）
├── resources/icons/              # 图标资源
├── docs/                         # 开发文档（DEVELOPMENT.md）
├── electron.vite.config.ts       # ✅ 实际生效的构建配置（main / preload / renderer 三段）
├── vite.config.ts                # ⚠️ 历史残留：独立的前端 web 构建配置（端口3000），无 npm 脚本引用，仅 tsconfig 用于类型检查
├── tsconfig.json / tsconfig.node.json
├── .eslintrc.js / .prettierrc
└── package.json
```

## 快速开始

### 环境要求

- Node.js 18+
- Git

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建打包

```bash
npm run build
```

> ⚠️ `npm run build` 仅编译产物到 `dist-electron/`（main / preload / renderer），**不包含打包成安装包（.exe）的步骤**（未集成 electron-builder / electron-forge）。如需生成安装包，需另行补充配置。

## 常见问题排查

### 启动报错 `Error: Electron uninstall` / `getElectronPath`

**原因**：`electron` 包通过 postinstall 脚本从 GitHub 下载预编译二进制到 `node_modules/electron/dist/`。如果该步骤没完成（网络问题、`allowScripts` 未放开、或缓存损坏），`dist/` 下会缺少 `electron.exe` 和 `path.txt`，导致 electron-vite 启动时找不到 electron。

**判断方法**：检查以下文件是否存在且有效：

```bash
# 应输出 electron.exe
cat node_modules/electron/path.txt
# 应存在 176MB 左右的可执行文件
ls node_modules/electron/dist/electron.exe
```

**解决办法**（按推荐顺序）：

1. **手动重跑 electron 的安装脚本**（最简单）：
   ```bash
   node node_modules/electron/install.js
   ```

2. **网络问题**（国内访问 GitHub releases 经常超时），使用 npmmirror 镜像后重装：
   ```bash
   export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
   npm rebuild electron
   # 或单独重跑：
   node node_modules/electron/install.js
   ```

3. **缓存损坏**（`@electron/get` 报 `Cache hit` 但解压失败）：清空 electron 缓存后重下：
   ```bash
   # 清缓存（缓存目录：%LOCALAPPDATA%\electron\Cache）
   rm -rf "$LOCALAPPDATA/electron/Cache"
   node node_modules/electron/install.js
   ```

4. **兜底方案**（缓存的 zip 完好但 `install.js` 解压异常时）：缓存 zip 位于 `%LOCALAPPDATA%\electron\Cache\<hash>\electron-v<版本>-win32-x64.zip`，可用 PowerShell 手动解压并补写 `path.txt`：
   ```powershell
   Expand-Archive -Path "<缓存中的 electron-*.zip>" -DestinationPath "node_modules\electron\dist" -Force
   Set-Content -Path "node_modules\electron\path.txt" -Value "electron.exe" -NoNewline
   ```

### 重装依赖时的注意事项

- `package.json` 中已配置 `allowScripts`（放行 `electron` 与 `esbuild` 的 postinstall）。换机器或重装依赖时，确认这两个原生依赖的二进制已正确下载，否则需按上文步骤排查。
- 本项目数据存储基于**本地文件**（项目目录 `.novelwriter/` 下的 json + 各目录的 `.md`），不依赖数据库服务，无需额外启动 SQLite 等服务。

## 开发路线图

详细开发计划请查看 [开发路线图文档](docs/DEVELOPMENT.md)

### 开发进度总览

| 阶段 | 名称 | 状态 | 优先级 |
|------|------|------|--------|
| 1 | 项目脚手架搭建 | ✅ 完成 | 🔴 最高 |
| 2 | Electron与Vite集成 | ✅ 完成 | 🔴 最高 |
| 3 | 主进程与渲染进程通信 | ✅ 完成 | 🔴 最高 |
| 4 | 基础窗口管理 | ✅ 完成 | 🔴 最高 |
| 5 | 页面路由系统 | ✅ 完成 | 🔴 最高 |
| 6 | Monaco编辑器集成 | ✅ 完成 | 🔴 最高 |
| 7 | 多文档Tab管理 | ✅ 完成 | 🔴 最高 |
| 8 | 文件保存与读取 | ✅ 完成 | 🔴 最高 |
| 9 | 新建/打开项目功能 | ✅ 完成 | 🔴 最高 |
| 10 | 章节CRUD操作 | ✅ 完成 | 🔴 最高 |
| 11 | 章节树与大纲视图 | ✅ 完成 | 🟡 高 |
| 12 | 角色卡片系统 | ✅ 完成 | 🟡 高 |
| 13 | 世界观设定模块 | ✅ 完成 | 🟡 高 |
| 14 | 专注模式与打字机模式 | ✅ 完成 | 🟡 高 |
| 15 | 快捷键与命令面板 | ✅ 完成 | 🟡 高 |
| 16 | 写作统计功能 | ✅ 完成 | 🟢 中 |
| 17 | 导入导出功能 | ✅ 完成 | 🟢 中 |
| 18 | 主题与UI打磨 | ✅ 完成 | 🟢 中 |
| 19 | 深色主题优化 | ✅ 完成 | 🟢 中 |
| 20 | Bug修复与稳定性 | ✅ 完成 | 🟢 中 |

**进度**: 20 / 20 阶段完成 🎉

### 状态说明
- ✅ 已完成
- 🔄 开发中
- ⏳ 待开发

## 项目配置格式

### 项目结构

```
project/
├── .novelwriter/
│   ├── config.json           # 项目配置
│   ├── workspace.json        # 工作区状态
│   └── database.db           # SQLite数据库
├── chapters/                  # 章节目录
│   ├── 01-楔子.md
│   ├── 02-第一章.md
│   └── 03-第二章.md
├── characters/                # 角色文档
├── settings/                  # 世界观设定
├── notes/                     # 灵感笔记
├── backup/                    # 自动备份
└── .gitignore
```

### 数据模型

```typescript
// 章节
interface Chapter {
  id: string;
  title: string;
  content: string;
  order: number;
  status: 'draft' | 'revising' | 'completed';
  wordCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// 角色
interface Character {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'other';
  age: number;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  appearance: string;
  personality: string;
  background: string;
  relationships: Relationship[];
  tags: string[];
}
```

## 快捷键参考

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+P` | 打开命令面板 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+Shift+S` | 保存全部 |
| `Ctrl+N` | 新建章节 |
| `F8` | 专注模式 |
| `F9` | 打字机模式 |
| `Ctrl+B` | 粗体 |
| `Ctrl+I` | 斜体 |
| `Ctrl+Shift+O` | 大纲导航 |

## 许可证

MIT License
