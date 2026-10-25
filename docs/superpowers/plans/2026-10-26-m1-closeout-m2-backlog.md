# M1 收尾记录 & M2 待办清单

日期：2026-10-26 ｜ 分支：feat/m1-ui-foundation（16b1aed..22e4636，11 提交）
计划：`2026-10-25-m1-ui-polish-foundation.md` ｜ 规格：`../specs/2026-10-25-perfect-novel-repositioning-design.md`

## 状态

10/10 任务实现并逐个过审；整分支终审（opus）判定 With fixes，4 项修复波全部复核 ADDRESSED。
HEAD 门禁实测：typecheck 0 错（入 build 门禁）、lint 0 error（1 条既有 react-refresh warning）、vitest 18/18、build ✓。

## 欠人工执行的 DoD 冒烟（合并发版前过一遍）

1. **首启搬运（RF2，最重要）**：本机存在 `%APPDATA%\novel-writer` → 首次运行新构建后确认主题选择、窗口几何、最近项目、编辑器设置全部保留；`%APPDATA%\perfect-novel` 出现 `.migrated` 标记；第二次启动不重复搬运。
2. **中文计数（RF1）**：输入 `你好 Hello 123` → 工具栏与状态条一致为 4；保存后章节字数列一致。
3. **脏数据路径（RF5）**：打字→切章→返回内容在；打字→面板 Ctrl+P"保存文件"→关窗→重开内容在（FI-2 回归点）；打字→直接关窗→重开内容在。
4. **双主题防闪（RF3）**：亮/暗各冷启动 3 次无闪白/错色；Modal/主按钮（含禁用态）/树/Tab 观感与迁移前一致。
5. **旧书目录（RF4）**：打开既有项目→编辑→Ctrl+S→导出 md/docx/epub/pdf 全成功。
6. **排版气质**：300 字中文正文——衬线、约 46 字/行（760px 列，计划里"37 字"为笔误以 760 为准）、行高松于旧版；F 专注模式只剩正文+轻量 Header；打字机光标居中如旧。
7. GitHub 仓库改名（外向操作，发起人执行/授权）：改后 `menu.ts` 帮助链接自然生效。

## M2 待办（终审 triage  rides-to-M2 汇总）

- **数据基石（M2 主体）**：全套 schema、数据访问层（单一入口+缓存失效+文件监听）、就地迁移（`<book>/.migration-backup/`）、卷一等公民、关系按 id 引用（修复 setting 文件名前 8 位匹配/章节 id 编码文件名两处断链病）。
- ChapterTree 真实拖拽排序（onDrop 重做，接 chapter:reorder）。
- editorStore.focusMode/typewriterMode 死接线（ThemeSettings 写入但 Workspace 用本地 state）→ 统一真源。
- handlers.ts 去掉 registerAllIpcHandlers 的 export（双注册 footgun）。
- NovelWriterApi.on.* 四个死事件通道：接线或裁剪。
- chapter:update 回显用 countWords 刷新 wordCount（终审 Minor 6，1 行）。
- useWritingStats 加载平铺 set → 函数式合并（2 行）；增量 reducer 抽纯函数补测。
- dayjs 死依赖：最近项目补"打开时间"显示或删依赖。
- userData merge-copy 的 file↔dir 同名碰撞边角（静默跳过仍写标记）。
- dev 环境 disable-web-security 三开关收紧 + 导出隐藏窗 webPreferences 加固（M4 AI 联网前必须）。
- antd 升级检查清单：disabled 保真规则依赖 `.ant-btn-variant-solid` 类名形态。
- README:41 ipc/handlers.ts 树描述更新为按域拆分。
- 跨午夜偶发的 statsService 测试 → 注入固定日期。

## 本计划内已裁定的偏差（摘要，全文见 git log 与各 task report）

- 第123章计数 === 3（汉字各 1、数字串 1）；工具栏冒烟期望值 4（计划笔误 5）。
- 更名提前至 M1、token 账本不独立里程碑、卷一等公民、双协议 adapter、迁移硬切、回填出 MVP、schema 全做 UI 分步点亮（发起人拍板项）。
- FI-1 迁移守卫：标记文件+合并复制（否决"只拷 JSON"——会丢 userData/Local Storage 下的 zustand 持久化数据）。
- IPC 合一后 saveFile filters 首次真正生效（修掉 preload 旧 bug）。
