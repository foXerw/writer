# 完美小说 (perfect-novel)

完美小说 – AI 共著的小说创作工作台：一个参考VSCode风格的专业小说写作应用，支持长篇创作、卷与章节管理、角色与世界观设定、设定图谱，并以 AI 共著为核心定位——AI 只提议、人拍板落盘，正式数据永远由你亲手确认（M1-M6 已全部交付）。

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React 18** - 前端UI框架
- **TypeScript** - 类型安全（`npm run build` 内置 typecheck 门禁）
- **Vite 5** - 快速构建工具
- **Monaco Editor** - VSCode同款编辑器内核（衬线纸感排印、ghost 补全、审阅跳转高亮）
- **React Flow (@xyflow/react)** - 设定图谱只读画布（五视图）
- **本地文件存储** - 一本书 = 一个 v2 书籍目录（book.json + YAML 实体 + front-matter Markdown 章节），通过 IPC 读写（无数据库依赖）；格式规范见 [docs/BOOK_FORMAT.md](docs/BOOK_FORMAT.md)
- **Zustand** - 轻量状态管理
- **Ant Design 5** - UI组件库
- **Vitest** - 单元测试（纯函数切片 + 主进程仓库/通道，门禁定版 968 用例全绿）

## 特性总览

### 数据基石（M2）
- **v2 书籍目录**: 书 = 一个普通文件夹——`book.json` + 卷 + front-matter 章节 + 人物卡/世界观词条 YAML + 剧情线/关键选项/伏笔台账；v1 老书打开时自动就地迁移并整本备份，迁移报告可见
- **卷与关系一等公民**: 章节按卷归档、删卷先疏散；人物关系按实体 id 引用不断链，卷/关系/叙事状态同时进图谱与 AI 上下文
- **外部改动感知**: 文件监听 + 冲突弹窗（保留我的 / 重新加载 / 磁盘被删时整体重建救援）；按内容比对判定，不误报自己的保存回声

### 写作体验
- **衬线纸感排版**: 思源宋体正文、纸面底色、行高随字号派生；深色/浅色双主题全应用 token 联动（含 Monaco 主题与滚动条配色）
- **专注模式 / 打字机模式**: 专注时降为轻量头部条去干扰；打字机保持光标居中
- **VSCode 风格操作面**: 命令面板 (Ctrl+Shift+P)、多文档 Tab（右键关闭族）、可折叠侧边栏、大纲视图、顶部工具栏与底部状态栏实时字数、快捷键全可自定义（冲突检测内建）
- **编辑器视图态恢复**: 写作↔图谱来回切换按章配对恢复光标/滚动，绝不把旧章光标复活进他章
- **整理可取消**: AI 整理/审阅在途期间可一键中止在途请求，已完成部分留存
- **自动保存**: 按项目配置间隔静默落盘（默认 30s），切章/返回首页/关窗均有 flush 兜底
- **导出**: Markdown/Word/PDF/ePub（CRLF/LF 段落切分同权）

### 设定图谱（M3/M4c-2）
- **五视图**: 人物关系 / 世界观 / 剧情走向 / 关键选项 / 角色成长（默认主角，带角色选择器），随书目录变更实时刷新（外部改动与应用内保存双腿都即时）
- **跳章节**: 节点弹「出现章节」菜单（AI 索引 ∪ 显式引用并集，悬挂引用自动剔除），选中直达该章编辑器；无引用节点回退打开对应侧栏面板

### AI 整理闭环（M4a/M4b）
- **双协议 BYOK**: OpenAI 兼容（DeepSeek/Kimi/通义/OpenRouter 等兼容端点）与 Anthropic 两路适配器，自带密钥；失败按类型（密钥被拒/网络不通/超时…）中文归因展示
- **密钥安全姿态**: 明文 API Key 只存主进程 `userData/ai-settings.json`，UI 仅掩码展示（前3…后4）、永不回填，密钥不出现在书目录/日志/账本
- **整理本章**: AI 在分层上下文中读取当前章正文，对角色卡/世界观/剧情线/选项/伏笔/章摘要/实体索引提出变更**建议**——提案即文件落盘 `.ai/proposals/*.yaml`（一章至多一份未消化提案，图谱入口徽章计数），AI 永不直写正式数据
- **差异确认**: 面板逐条列出动作/目标/改动摘要/出处引文，逐条采纳或驳回；覆盖人写内容的条目显式橙警**默认不勾选**（origin 铁律），AI 写过的字段经 `aiTouched` 记名、后续整理不误伤
- **幂等采纳**: 采纳引擎 create 带 `aiSource` 幂等令牌，记账写失败后重试不产生重复实体（无双胞胎）

### 叙事录入（M4c-2）
- **叙事面板**: 侧栏第五个 tab——剧情线（阶段链）/ 关键选项（挂章分支）/ 伏笔台账（埋章→回收/弃置→重开状态机）三合一录入；保存即时联动图谱与整理上下文

### AI 实时补全（M5）
- **ghost text**: 文末停笔 900ms 光标处浮现灰色建议文字，Tab 采纳、Esc 撤销；流式逐 token 追加，视口底部采纳即回显
- **默认关（opt-in）**: 设置页「写作补全（默认关）」显式开启才生效；上下文 = 光标前正文 + 本章引用设定实体卡投影（**设定卡优先**，无卡自由续写也不与设定矛盾），输出 ≤3 句
- **不打扰宪法**: 输入法组字中、段中修订态、切章/切视图一律不弹或即时清场；任何失败（断网/坏配置/超时）静默无提示，绝不打断写作流

### 章节审阅（M6）
- **六类意见段落锚定**: AI 以读者/编辑视角通读（默认当前章，可选连续至多 5 章、逐章各发一次请求），硬伤三类（伏笔未回收/设定冲突/动机断裂）+ 软感受三类（节奏/人物扁平/文笔）按硬软分色分组、流式呈现；每条意见带原文锚句，点「跳转」在编辑器**精确高亮**（跨章跳转按模型落定后应用，绝不错位）；正文改版转「锚已失」，重审未重现标「上次未重现」，驳回后重审同章抑制不复读
- **一键转提案**: 硬意见可**转化**为伏笔台账 create / 世界卡/角色卡 update 提案（目标指错弹实体选择器兜底），同章已有未消化提案时**并入**该提案（additive 追加，不放宽「一章一份未消化提案」闸门），随后复用差异面板逐条确认；软意见只可驳回（散文是作者地盘）
- **只读铁律**: 审阅全链（含转提案）**零写字书内容域**——只写 `.ai/reviews/` 意见账本与 `.ai/proposals/` 提案文件，正式数据仍由你经差异面板亲手采纳落盘
- **预算与取消**: 单章输入超预算在任何请求发起前整体拒绝（零花费）；范围逐章在途可随时取消，已完成章意见留存

### 统计与 token 分账
- **写作统计**: CJK 码点口径字数统计（中文不再数成 1）、今日目标进度、活跃时长、streak 与趋势，按项目 `stats.json` 持久化
- **AI 用量分账**: 每本书 `.ai/usage.jsonl` 按功能（整理/补全/审阅）与模型记录用量（只含计数，永不含正文与密钥），侧栏「AI 用量」按功能汇总实时刷新

## 快速开始

### 环境要求

- Node.js 18+
- Git

### 安装与运行

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（electron-vite）
npm run build      # 构建：先过 typecheck 门禁，再编译产物到 dist-electron/
```

### 测试门禁

```bash
npm run typecheck  # tsc --noEmit，须 0 错
npm run lint       # eslint，0 error（1 条既有 react-refresh warning）
npm run test       # vitest run，968 用例全绿（基线见 docs/DEVELOPMENT.md）
```

### BYOK 配置（全部 AI 功能的前置）

侧栏顶部书名旁的齿轮钮进入设置页 →「AI 服务」区块：选**协议**（OpenAI 兼容 / Anthropic）→ 填 **Base URL** 与 **API Key** → **默认模型**；展开「高级（按功能覆盖模型）」可分别为**整理 / 补全 / 审阅**三个功能槽指定模型（留空 = 使用默认模型）。「测试连接」可随时验证配置，「清除密钥」一键删 key。

- **补全开关**: 同区块「写作补全（默认关）」——**默认关闭**，显式开启才弹灰字（opt-in）。
- **审阅开关**: 无独立开关，工具栏「审阅」按钮常可用（需打开书籍 + 有当前章；AI 未配置时对话框内给出中文错误节，不弹窗打扰）。

> ⚠️ `npm run build` 仅编译产物到 `dist-electron/`（main / preload / renderer），**不包含打包成安装包（.exe）的步骤**（未集成 electron-builder / electron-forge）。如需生成安装包，需另行补充配置。

## 项目结构

```
perfect-novel/
├── electron/
│   ├── main/
│   │   ├── index.ts              # 主进程入口
│   │   ├── window.ts             # 窗口管理（BrowserWindow）
│   │   ├── menu.ts               # 应用菜单
│   │   ├── tray.ts               # 系统托盘
│   │   ├── bookStore/            # v2 书籍数据仓库：迁移/原子写/域缓存/fs 监听/reviews 账本（格式见 docs/BOOK_FORMAT.md）
│   │   ├── ai/                   # AI 服务层：settings 保险库/providers 双协议/chatService 流式通道/usage 账本
│   │   └── ipc/
│   │       ├── helpers.ts        # IPC 公共辅助
│   │       └── modules/          # IPC 处理（project/chapter/volume/character/setting/narrative/ai/proposal/review/export/…）
│   └── preload/
│       └── index.ts              # 预加载脚本（contextBridge 暴露 IPC）
├── src/
│   ├── common/                   # 跨进程纯逻辑（全部可单测）
│   │   ├── ipc.ts                # IPC 类型定义与通道常量
│   │   ├── schema.ts             # v2 数据模型 + 校验器（BOOK_FORMAT 逐字对照源）
│   │   ├── ai-types.ts           # AI 共享类型：设置/掩码视图/patch/用量记录/错误 kind 词表
│   │   ├── ai-context.ts         # 整理侧分层上下文装配器 + token 估算
│   │   ├── completionContext.ts / completionTrigger.ts / entityRefs.ts  # 补全装配器（设定卡投影）/纯触发状态机/实体→章节反查（M5）
│   │   ├── reviewContext.ts / reviewTypes.ts / reviewConvert.ts  # 审阅装配/意见 schema/转化映射（M6）
│   │   ├── proposal.ts / organizePrompt.ts / organizeResult.ts    # 提案 schema/整理提示词契约/结果校验
│   │   └── wordCount.ts / jsonLoose.ts / chapterDoc.ts           # 字数口径/宽容抠 JSON/章节文档
│   └── renderer/
│       ├── App.tsx               # 应用根组件
│       ├── index.tsx             # 渲染进程入口
│       ├── index.html            # HTML 模板
│       ├── components/            # React 组件
│       │   ├── Graph/            # 图谱五视图（GraphView / 节点组件 / graphModel 纯构图布局）
│       │   ├── Layout/           # 布局（EditorTabs）
│       │   ├── Editor/           # 编辑器（MonacoEditor / EditorToolbar / OutlineView）
│       │   ├── Explorer/         # 侧边面板（ChapterTree / CharacterPanel / SettingPanel / StatsPanel / NarrativePanel / VolumeManager）
│       │   ├── Dialogs/          # 对话框（CommandPalette / ExportDialog / ProjectDialog / ProposalReviewDialog / ReviewDialog / ShortcutDialog）
│       │   ├── Settings/         # 设置（ThemeSettings / AiSettingsSection）
│       │   └── Workspace/        # 侧栏宿主（SidebarPanel）
│       ├── pages/                # 页面（Home / Workspace / Settings）
│       │   └── Workspace/hooks/  # 编排层（useEditorSession / useAutoSave / useCompletion / useOrganize / useReview / useWritingStats …）
│       ├── stores/               # 状态管理（Zustand：项目最近列表/编辑器/快捷键/设置 四持久化 store）
│       ├── hooks/                # 自定义钩子（useIPC / useAI / useKeyboard / useMenu / useBookEvents）
│       ├── services/             # 前端服务（exportService / shortcutService / statsService / entityEvents / 中文错误词表 reviewErrors·proposalErrors·aiErrorText）
│       └── styles/               # 样式（global.css，token 主题层）
├── resources/icons/              # 图标资源
├── docs/                         # 开发文档（DEVELOPMENT.md / BOOK_FORMAT.md / superpowers 设计与计划）
├── electron.vite.config.ts       # ✅ 实际生效的构建配置（main / preload / renderer 三段）
├── tsconfig.json / tsconfig.node.json
├── vitest.config.ts              # 测试配置（npm run test）
├── .eslintrc.js / .prettierrc
└── package.json
```

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

## 文档地图

| 文档 | 内容 |
|------|------|
| [docs/BOOK_FORMAT.md](docs/BOOK_FORMAT.md) | 书籍数据目录格式规范（v2）：目录树全量、每类文件字段表（逐字对照 `src/common/schema.ts`）、`.ai/` 产物区（用量/提案/审阅账本/摘要/索引）、第三方与 AI 工具安全读写守则 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 工程与门禁：里程碑进度 M1-M6（每片交付明细与门禁/冒烟验证记录）、历史阶段与审计整改 |
| [docs/superpowers/specs/](docs/superpowers/specs) | 设计规格：总重定位（含里程碑表 §8）+ 各里程碑设计文档 |
| [docs/superpowers/plans/](docs/superpowers/plans) | 各里程碑实施计划 + **closeout 收尾记录**（裁定全集、实测记录、真机验证清单） |

**已知边界**不在本 README 展开：各里程碑 closeout 文档的「结转清单」是唯一权威（例如审阅的全书扫查与多人格视角属结转项、混合 EOL 病理书的跳转高亮 ±1 漂移注记等）。

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
| `Ctrl+S` | 保存当前章 |
| `Ctrl+N` | 新建章节 |
| `F8` | 专注模式 |
| `F9` | 打字机模式 |
| `Ctrl+Shift+O` | 大纲视图 |
| `Ctrl+Shift+B` | 粗体（编辑器内） |
| `Ctrl+Shift+I` | 斜体（编辑器内） |
| `Ctrl+F` | 查找（编辑器内） |
| `Tab` / `Esc` | 采纳 / 撤销补全灰字（仅灰字在场时接管，否则原样放行） |

> 上表为默认绑定；快捷键可在应用内自定义（含冲突检测），入口为应用菜单「帮助 → 快捷键参考」。

## 许可证

MIT License
