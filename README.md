# Novel Writer - 专业作家应用

一个参考VSCode风格的专业小说写作应用，支持长篇创作、角色管理、世界观设定等功能。

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React 18+** - 前端UI框架
- **TypeScript** - 类型安全
- **Vite 5** - 快速构建工具
- **Monaco Editor** - VSCode同款编辑器内核
- **SQLite + Prisma** - 本地数据存储
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
│   │   ├── app.ts                # 应用生命周期
│   │   ├── ipc/                  # IPC通信处理
│   │   │   ├── fileHandler.ts
│   │   │   ├── projectHandler.ts
│   │   │   └── searchHandler.ts
│   │   ├── services/             # 主进程服务
│   │   │   ├── fileService.ts
│   │   │   ├── dbService.ts
│   │   │   └── backupService.ts
│   │   └── window/               # 窗口管理
│   │       ├── WindowManager.ts
│   │       └── preload.ts
│   └── preload/
│       └── index.ts
├── src/
│   ├── renderer/
│   │   ├── components/           # React组件
│   │   │   ├── Layout/           # 布局组件
│   │   │   ├── Editor/           # 编辑器组件
│   │   │   ├── Explorer/         # 资源管理器
│   │   │   ├── Dialogs/          # 对话框
│   │   │   └── Common/           # 通用组件
│   │   ├── pages/                # 页面
│   │   │   ├── Home/             # 首页
│   │   │   ├── Workspace/        # 工作区
│   │   │   └── Settings/         # 设置
│   │   ├── stores/               # 状态管理
│   │   ├── hooks/                # 自定义钩子
│   │   ├── services/             # 前端服务
│   │   ├── utils/                # 工具函数
│   │   ├── styles/               # 样式文件
│   │   └── types/                # 类型定义
│   └── resources/                # 静态资源
├── scripts/                      # 构建脚本
├── vite.config.ts
├── electron.vite.config.ts
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
