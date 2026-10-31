# 完美小说 (perfect-novel)

完美小说 – AI 共著的小说创作工作台：一个参考VSCode风格的专业小说写作应用，支持长篇创作、角色管理、世界观设定等功能，并以 AI 共著为核心定位。

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React 18+** - 前端UI框架
- **TypeScript** - 类型安全
- **Vite 5** - 快速构建工具
- **Monaco Editor** - VSCode同款编辑器内核
- **本地文件存储** - 一本书 = 一个 v2 书籍目录（book.json + YAML 实体 + front-matter Markdown 章节），通过 IPC 读写（无数据库依赖）；格式规范见 [docs/BOOK_FORMAT.md](docs/BOOK_FORMAT.md)
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
- **叙事面板**: 剧情线（阶段链）/ 关键选项（挂章分支）/ 伏笔台账（埋章→回收/弃置→重开状态机）三合一录入，侧栏第五个 tab；保存即时联动图谱与整理上下文
- **图谱视图**: 人物关系 / 世界观 / 剧情走向 / 关键选项 / 角色成长 五视图（`写作|图谱` 切换，React Flow 只读画布，随书目录变更实时刷新；角色成长档带角色选择器，默认主角）
- **跳章节**: 图谱节点点击弹出「出现章节」菜单（实体→章节引用 = AI 索引 ∪ 显式引用并集，悬挂引用自动剔除），选中直达该章编辑器；无引用的节点回退打开对应侧栏面板
- **编辑器视图态恢复**: 写作↔图谱来回切换保留光标/滚动位置（按章配对，绝不把旧章光标复活进他章）
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

### AI 服务层（M4a）
- **双协议 BYOK**: OpenAI 兼容（含 DeepSeek/Kimi/通义/OpenRouter 等兼容端点）与 Anthropic 两路适配器，自带密钥；设置页「AI 服务」区块配置（协议/Base URL/密钥/默认模型/按功能覆盖），支持连接测试与清除密钥
- **密钥安全姿态**: 明文 API Key 只存主进程 `userData/ai-settings.json`，UI 仅掩码展示（前3…后4）、永不回填，密钥不出现在书目录/日志/账本
- **流式对话通道**: requestId 级隔离/取消/在途防重，失败按类型（密钥被拒/网络不通/超时…）中文归因展示
- **Token 分账**: 每本书 `.ai/usage.jsonl` 按功能与模型记录用量（只含计数，永不含正文与密钥），侧栏「AI 用量」按功能/模型汇总（换书、实体或用量变更时刷新）
- **分层上下文装配器**: 按优先级与 token 预算组装小说上下文（大纲/前文尾部/角色卡等），正文优先红线测试钉死（M4b 功能直接消费）

### AI 整理闭环（M4b）
- **整理本章**: AI 在分层上下文中读取当前章正文，对角色卡/世界观/剧情线/选项/伏笔/章摘要/实体索引提出变更**建议**——AI 只提议、永不直写正式数据，提案落盘为 `.ai/proposals/*.yaml`（图谱入口以徽章显示未消化份数）
- **人逐条确认**: 差异审阅面板逐条列出变更（动作/目标/改动摘要/出处引文），支持逐条采纳或驳回；同章存在未消化提案时禁止重复整理（按钮禁用 + 服务端 `PROPOSAL_DUPLICATE` 双闸门），徽章随消化自动回落
- **人写内容保护（origin 铁律）**: 你手写的字段 AI 动不了——覆盖人写内容的条目必须显式旗标，面板标橙警示且**默认不勾选**，由你亲手勾选确认才落盘；AI 写过的字段自动记名（`aiTouched`），后续整理改自己建的内容不误伤
- **整理可取消（M4c-2）**: 整理在途期间工具栏按钮原位变「取消」，点击即中止在途 AI 请求（toast「已取消整理」）；采纳引擎 create 带幂等令牌（`aiSource`），记账写失败后重试不产生重复实体

### 实时补全（M5）
- **写作补全（默认关）**: 停笔后光标处浮现灰色建议文字，Tab 采纳、Esc 撤销；设置页「AI 服务」区「写作补全（默认关）」开关显式开启才生效，可经补全槽覆盖模型（留空=默认模型）
- **停笔浮现与上下文**: 光标在正文文末、停笔 900ms 触发；上下文取光标前 ~1500 字 + 本章引用设定实体卡投影（优先按卡描写，无卡自由续写但不与设定矛盾），输出 ≤3 句
- **不打扰宪法**: 输入法组字中、段中修订态（光标后有余文）、切章/切视图一律不弹或即时清场；补全任何失败（断网/坏配置/超时）静默无提示，绝不打断写作流；被撤销的同句不再自动重弹
- **Token 分账**: 补全调用按 `feature=completion` 记入每本书 `.ai/usage.jsonl`，侧栏「AI 用量」按功能汇总可见

### 章节 AI 审阅（M6）
- **一键读者视角**: 工具栏「审阅」按钮打开对话框，AI 以读者/编辑视角通读当前章（可选连续至多 5 章，逐章各发一次请求），产出段落锚定的结构化意见：硬伤三类（伏笔未回收/设定冲突/动机断裂）+ 软感受三类（节奏/人物扁平/文笔），按章分组、流式呈现、硬软分色
- **可跳转的锚**: 每条意见带原文引句锚点，点「跳转」在编辑器精确高亮原句；正文改版后锚漂移该条转「锚已失」灰态（仍可驳回，跳转禁用）；重审未再重现的意见标「上次未重现」而非删除
- **消费闭环**: 硬意见一键**转提案**（复用 M4b 差异面板逐条确认，含覆盖人写橙警勾选），同章已有未消化提案时**并入**该提案（additive 追加，不放宽「一章一份未消化提案」闸门）；软意见只可驳回；驳回后重审同章不复读（抑制键防重）
- **只读铁律**: 审阅全链（含转提案）**零写字书内容域**——只写 `.ai/reviews/` 意见账本与 `.ai/proposals/` 提案文件，正式数据仍由你经差异面板亲手采纳落盘；调用按 `feature=review` 记入 `.ai/usage.jsonl`（模型取 review 槽，留空回落默认模型）

## 项目结构

```
perfect-novel/
├── electron/
│   ├── main/
│   │   ├── index.ts              # 主进程入口
│   │   ├── window.ts             # 窗口管理（BrowserWindow）
│   │   ├── menu.ts               # 应用菜单
│   │   ├── tray.ts               # 系统托盘
│   │   ├── bookStore/            # v2 书籍数据仓库：迁移/原子写/域缓存/fs 监听（格式见 docs/BOOK_FORMAT.md）
│   │   ├── ai/                   # AI 服务层（M4a）：settings 保险库/providers 双协议/chatService 流式通道/usage 账本
│   │   └── ipc/
│   │       ├── helpers.ts        # IPC 公共辅助
│   │       └── modules/          # IPC 处理（project/chapter/volume/character/setting/narrative/ai/…）
│   └── preload/
│       └── index.ts              # 预加载脚本（contextBridge 暴露 IPC）
├── src/
│   ├── common/
│   │   ├── ipc.ts                # IPC 类型定义与通道常量
│   │   ├── ai-types.ts           # AI 共享类型：设置/掩码视图/patch/用量记录/错误 kind 词表
│   │   └── ai-context.ts         # 分层上下文装配器 + token 估算（纯函数，M4a Task 5）
│   └── renderer/
│       ├── App.tsx               # 应用根组件
│       ├── index.tsx             # 渲染进程入口
│       ├── index.html            # HTML 模板
│       ├── components/            # React 组件
│       │   ├── Graph/            # 图谱视图（GraphView / CharacterNode / WorldNode / CardNode / graphModel 五视图纯构图布局）
│       │   ├── Layout/           # 布局（EditorTabs）
│       │   ├── Editor/           # 编辑器（MonacoEditor / EditorToolbar / OutlineView）
│       │   ├── Explorer/         # 侧边面板（ChapterTree / CharacterPanel / SettingPanel / StatsPanel / NarrativePanel）
│       │   ├── Dialogs/          # 对话框（CommandPalette / ExportDialog / ProjectDialog）
│       │   └── Settings/         # 设置（ThemeSettings / AiSettingsSection）
│       ├── pages/                # 页面（Home / Workspace / Settings）
│       ├── stores/               # 状态管理（Zustand）
│       ├── hooks/                # 自定义钩子（useIPC / useKeyboard / useMenu）
│       ├── services/             # 前端服务（statsService / exportService / shortcutService）
│       └── styles/              # 样式（global.css）
├── resources/icons/              # 图标资源
├── docs/                         # 开发文档（DEVELOPMENT.md）
├── electron.vite.config.ts       # ✅ 实际生效的构建配置（main / preload / renderer 三段）
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
- 本项目数据存储基于**本地文件**（每本书一个 v2 目录：`book.json` + 各实体 `<uuid>.yaml` + 章节
  `<uuid>.md`，格式见 [docs/BOOK_FORMAT.md](docs/BOOK_FORMAT.md)），不依赖数据库服务，无需额外启动
  SQLite 等服务。

## 开发路线图

详细开发计划请查看 [开发路线图文档](docs/DEVELOPMENT.md)

### 开发进度总览

> ⚠️ 下表为 2026-06-25 复审后的真实状态，详见 [审计报告](docs/AUDIT.md)。2026-06-24 审计指出阶段 12/13/16/17 基本为空壳；2026-06-25 已接线修复阶段 8/10/11/12/13/14/18（结构修复 + 死代码接线），阶段 15/16/17 仍待做。

| 阶段 | 名称 | 状态 | 优先级 |
|------|------|------|--------|
| 1 | 项目脚手架搭建 | ✅ 已实现 | 🔴 最高 |
| 2 | Electron与Vite集成 | ✅ 已实现 | 🔴 最高 |
| 3 | 主进程与渲染进程通信 | ✅ 已实现 | 🔴 最高 |
| 4 | 基础窗口管理 | ✅ 已实现 | 🔴 最高 |
| 5 | 页面路由系统 | ✅ 已实现（设置页已接线，渲染 ThemeSettings） | 🔴 最高 |
| 6 | Monaco编辑器集成 | ✅ 已实现 | 🔴 最高 |
| 7 | 多文档Tab管理 | ✅ 已实现（右键菜单已补：关闭/其他/右侧/全部） | 🔴 最高 |
| 8 | 文件保存与读取 | ✅ 已实现（自动保存已接线，30s 间隔） | 🔴 最高 |
| 9 | 新建/打开项目功能 | ⚠️ 部分 | 🔴 最高 |
| 10 | 章节CRUD操作 | ✅ 已实现（重命名已接 renameChapter） | 🔴 最高 |
| 11 | 章节树与大纲视图 | ✅ 已实现（大纲已渲染 + 行导航） | 🟡 高 |
| 12 | 角色卡片系统 | ✅ 已实现（增删改接 IPC 持久化 + tags） | 🟡 高 |
| 13 | 世界观设定模块 | ✅ 已实现（增删改接 IPC + 树节点操作） | 🟡 高 |
| 14 | 专注模式与打字机模式 | ✅ 已实现（专注模式收起侧栏） | 🟡 高 |
| 15 | 快捷键与命令面板 | ✅ 已实现（自定义绑定 + 冲突检测，应用级持久化） | 🟡 高 |
| 16 | 写作统计功能 | ✅ 已实现（按项目 stats.json：今日字数/活跃时长/streak/CSS 趋势） | 🟢 中 |
| 17 | 导入导出功能 | ✅ 已实现（Markdown/Word/PDF/ePub 导出） | 🟢 中 |
| 18 | 主题与UI打磨 | ✅ 已实现（字号/换行/行号接编辑器） | 🟢 中 |

**真实进度**: 端到端可用链路为「撰写正文 + 角色/设定 CRUD + 章节重命名 + 大纲导航 + 自动保存（静默）+ 菜单栏动作 + 编辑器设置（设置页可达）+ Tab 右键菜单 + 切章/返回/关窗自动 flush + Markdown/Word/PDF/ePub 导出 + 写作统计 + 快捷键自定义」。除阶段 9 仍部分（配置路径/最近项目内存态）外，阶段 1–18 已 ✅；仅余可选的「每章一文件」导出与「导入」功能未做。

### 深色/浅色双主题切换

- **状态**: ✅ 代码完成（`npm run lint` 0 错误 + `npm run build` 通过；全仓 hex 残留审计通过）。⚠️ **双主题人工视觉 QA（在 GUI 中逐屏走查深/浅两套主题）为合并前剩余步骤，尚未执行。**
- **机制**: `useSettingsStore` 持久化 `themeMode: 'dark'|'light'`（zustand + localStorage，key `settings-storage`）；`<html data-theme>` 选择 `global.css` 中两套 `--color-*` 变量，组件内联色统一走 `var(--color-*)`；antd `<ConfigProvider>` 按 `darkTheme`/`lightTheme` token 注入（`src/renderer/styles/theme.ts`）；Monaco 在 `novel-dark`/`novel-light` 间响应式切换；主进程经 `theme:set` IPC 持久化至 `<userData>/theme.json`，使原生 `BrowserWindow` 背景同步、消除冷启动闪烁；深色专属 `!important` 覆盖收束在 `[data-theme='dark']` 作用域下。可在设置页（深色/浅色按钮）或顶部栏快捷开关（日/月图标）切换。

### 状态说明
- ✅ 已完成
- 🔄 开发中
- ⏳ 待开发

## 书籍数据目录格式（v2）

> **完整规范见 [docs/BOOK_FORMAT.md](docs/BOOK_FORMAT.md)**：目录树全量、每类文件字段表（对照
> `src/common/schema.ts`）、章节 front-matter 示例、`.migration-backup/` 与
> `.novelwriter.json.migrated` 只读约定、`.ai/`（用量账本 `usage.jsonl` + 提案 `proposals/` +
> 审阅意见账本 `reviews/` + 章摘要 `summaries/` + 实体索引 `index.json`）说明与密钥
> 存放姿态，以及「第三方 / AI 工具如何安全读写
> 一本书」操作守则。旧版（v1，`.novelwriter.json` + `settings/` + `NNN-标题.md`）在打开时会被自动
> 就地迁移为 v2（先整本备份），无需手工转换。

一本书 = 一个普通文件夹，v2 骨架：

```
<书目录>/
├── book.json            # 书元信息 + 项目配置（formatVersion: 2）
├── chapters/<uuid>.md   # 章节 = front-matter + 正文
├── volumes/<uuid>.yaml  # 卷
├── characters/<uuid>.yaml  # 人物卡（关系边按 id）
├── world/<类别>/<uuid>.yaml # 世界观词条（location/history/magic/culture/other）
├── plotlines/ choices/  # 剧情线 / 关键选项（录入 UI = 侧栏「叙事」面板，M4c-2）
├── foreshadow.yaml      # 伏笔台账
├── .ai/                 # AI 产物区（用量账本/提案/审阅意见账本/摘要/索引，按需创建，详见 BOOK_FORMAT.md §7）
└── .migration-backup/   # 迁移备份（只读，详见 BOOK_FORMAT.md）
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
