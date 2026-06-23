# Novel Writer 实现审计报告

> 审计时间: 2026-06-24
> 方法: 逐阶段对照 `docs/DEVELOPMENT.md` 的交付物清单，核查真实代码（非仅检查文件是否存在）
> 结论: README 宣称的「20/20 阶段全部完成 🎉」**严重名不副实**。大量「✅完成」实际是死代码、空壳或未接线的半成品。

---

## 状态图例

- ✅ 已实现：功能真实可用，端到端打通
- ⚠️ 部分完成：核心在但有缺陷 / 死代码 / 未接线
- ❌ 空壳：组件存在但不可用，或声称的功能完全缺失

---

## 逐阶段结论

### ✅ 真正完成

| 阶段 | 名称 | 状态 | 备注 |
|------|------|------|------|
| 1 | 项目脚手架搭建 | ✅ | 配置文件齐全且正确 |
| 2 | Electron 与 Vite 集成 | ✅ | 三段构建、窗口创建真实 |
| 3 | 主进程与渲染进程通信 | ✅ | IPC/preload/hooks 齐全（但见「结构性问题」一节） |
| 6 | Monaco 编辑器集成 | ✅ | 主题注册、字数统计真实。⚠️ 粗体/斜体实际绑定为 `Ctrl+Shift+B/I`，非文档所称的 `Ctrl+B/I` |

### ⚠️ 部分完成

| 阶段 | 名称 | 缺陷说明 |
|------|------|----------|
| 4 | 基础窗口管理 | 多窗口 / window-state / 托盘均真实，但菜单事件桥接断裂（见结构性问题） |
| 5 | 页面路由系统 | Settings 页是占位符，仅渲染「设置 - 开发中」，非功能页 |
| 7 | 多文档 Tab 管理 | 持久化 / 关闭逻辑真实；❌ **右键菜单未实现**（`onContextMenu` 是空函数），只有左键溢出菜单 |
| 8 | 文件保存与读取 | ❌ **自动保存是死代码**：`startAutoSave` 已定义但全项目零调用，实际只有手动 Ctrl+S |
| 9 | 新建/打开项目 | ⚠️ 配置文件路径与文档不符（实际 `.novelwriter.json`，文档称 `.novelwriter/config.json`）；后端「最近项目」用内存 Map，重启即丢 |
| 10 | 章节 CRUD | ❌ **重命名功能损坏**：弹窗只改本地变量并弹成功提示，从不调用 `renameChapter`；`copyChapter` 是空桩 |
| 11 | 章节树与大纲 | ❌ **OutlineView 大纲组件已编写但从未被渲染**（死代码）；章节状态后端永远硬编码 `draft`，无修改入口 |
| 14 | 专注模式与打字机 | 打字机光标居中真实；❌ 专注模式**不隐藏侧边栏**（只禁用编辑器右键）；字号设置未传给编辑器 |
| 15 | 快捷键与命令面板 | 命令面板、快捷键真实；❌ **快捷键冲突检测、快捷键自定义**两个目标完全缺失 |

### ❌ 空壳（声称完成，实际不可用）

| 阶段 | 名称 | 真相 |
|------|------|------|
| 12 | 角色卡片系统 | CharacterPanel **调用了错误的 API**（`getAllChapters`）并强制 `setCharacters([])`，列表永远空；`handleSave` 从不调用 `create/update` IPC，编辑不持久化；标签字段缺失 |
| 13 | 世界观设定模块 | SettingPanel 用 `setSettings([])` 模拟数据；`handleSave` / `handleDelete` 只弹提示，从不调用 IPC，**增删改全部失效** |
| 16 | 写作统计功能 | 使用**硬编码 mock 数据**；写作时长 `updateDuration()` 是死代码（零调用），时长永远 0；**无图表**（仅进度条 / 数字卡片）；无历史数据持久化 |
| 17 | 导入导出功能 | **整个功能不可用**：ExportDialog 组件**从未被渲染**；无任何 Markdown / Word / PDF / ePub 导出实现；`package.json` 中**无** docx / epub / pdf 转换库。Word / PDF / ePub 的「✅完成」不实 |
| 18 | 主题与 UI 打磨 | ThemeSettings 的字号 / 换行 / 行号设置**未接到编辑器**（Workspace 从不传这些 props），调了无反应；浅色主题按钮禁用 |

---

## 🔴 结构性问题（贯穿多个阶段）

1. **菜单 IPC 桥接断裂**：`electron/main/menu.ts` 通过 `webContents.send` 发送 `menu:*` 事件，但 `electron/preload/index.ts` **从未暴露任何 `menu:*` 监听器** —— 菜单栏中「新建项目 / 导出」等动作在渲染进程全部失灵。
2. **preload 类型错误**：`NovelWriterAPI` 中 `.character` / `.setting` 的类型被错写成 `Chapter`（复制粘贴错误，`preload/index.ts` 约 150-163、200-213 行）。
3. **文档自相矛盾**：
   - README 称 **20** 个阶段，DEVELOPMENT.md 称 **18** 个阶段；
   - DEVELOPMENT.md 总览表将阶段 12-18 标「待开发」，而详情又标「✅完成」；
   - README 与实际实现严重不符。

---

## 实际可用的核心链路

经审计，当前真正端到端可用的功能集中在「撰写小说正文」这条线：

> 新建/打开项目 → 章节树 → Monaco 编辑器写作 → 手动保存（Ctrl+S）→ 多 Tab 管理（持久化）

阶段 12（角色）、13（世界观）、16（统计）、17（导出）基本是摆设，需要接线或重做。

---

## 建议修复优先级

1. **修结构性断点**（菜单 IPC、preload 类型错误）——影响最广，工作量小
2. **接线死代码**：
   - 阶段 12 角色：`save/delete` 接 `character:*` IPC，`loadCharacters` 改用正确 API
   - 阶段 13 设定：`save/delete` 接 `setting:*` IPC
   - 阶段 11 大纲：在 Workspace 渲染 `OutlineView` 并接 `revealLineInCenter`
   - 阶段 8 自动保存：将 `startAutoSave` 在 Workspace 接线
   - 阶段 10 重命名：`ChapterTree` 调用 `renameChapter`
3. **砍掉或重做假功能**：
   - 阶段 17 导出：要么真正实现（先做 Markdown，再视需求加 Word/PDF/ePub），要么从路线图移除
   - 阶段 16 统计：移除 mock 数据，实现时长计时 + 持久化，引入图表库或简化为数字看板
4. **校正文档**：让 README / DEVELOPMENT.md 与现实一致（本审计即为此目的的第一步）
