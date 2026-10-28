# M4c-2：叙事录入 + 图谱 3-5 视图 + 跳章节 + 幂等收口 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 点亮 spec M4c：剧情线/关键选项/伏笔三录入面板、图谱第三~五种视图（剧情走向/关键选项/角色成长）、实体→章节跳转（索引+显式引用并集）、采纳引擎 create 幂等（关双胞胎窗），并收口 M3/M4a/M4b/M4c-1 全部结转小项。

**Architecture:** 跳转数据 = `.ai/index.json`（AI 维护）∪ 显式引用（arc/plotline stages/choice/foreshadow 的 chapterIds，纯函数并集）；新图谱视图复用 graphModel 纯函数模式 + GraphView 画布；叙事面板走既有 narrative 通道；幂等靠实体自带 `aiSource` 令牌（零窗口，优于账本侧登记）。

**Tech Stack:** 既有栈，零新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-28-m4-ai-loop-design.md`（§8 M4c 验收）；结转清单：`2026-10-28-m4b-closeout.md` + `2026-10-28-m4c1` 审查 minors。

## Global Constraints

- 零新增运行时依赖；门禁沿用（typecheck 0 入 build / lint 0 error / vitest 全绿 / build）；每任务一提交带 Co-Authored-By。
- 面板/图谱全部消费既有通道（narrative:*、foreshadow:*、chapter:*、book:readAiData），**不新增 IPC 通道**（跳转并集在渲染层纯函数算）。
- 新 UI 全中文、token 化样式、无 !important 新账；React 组件层无单测（无 jsdom），纯逻辑必须单测。
- 图谱仍只读（拖拽/编辑留未来）；节点点击行为=跳章节菜单（有引用时）/打开实体卡（无引用时回退 M3 行为）。
- 现状基线：main=M4c-1 后，vitest 665。

## Review Focus

1. **幂等真关窗**：markSettled 抛穿后重试同批 → create 不双胞胎（aiSource 命中即跳过并记账）；update/delete 路径不受影响（T1 判别测试）。
2. **跳转并集正确性**：index.json 与显式引用去重合并；悬挂 chapterId（章已删）剔除不崩；空引用回退 M3 点击行为（T2/T4 测试+冒烟）。
3. **五视图切换状态**：kind 切换不串数据（arc 视图的角色选择器状态随 kind 重置）；空数据各视图空态文案（T4 冒烟）。
4. **叙事面板与引擎守卫一致**：面板不得绕过 narrative 状态机（resolve/abandon/reopen 走通道）；REF_BROKEN/转移错误中文可读（T5）。
5. **viewState 跨切换**：写作↔图谱来回，光标/滚动恢复；typing 中切换不丢脏内容（既有 useEditorSession 保证内容，本任务只补视图态）（T6 冒烟）。

---

### Task 1: create 幂等（aiSource 令牌）

**Files:**
- Modify: `src/common/schema.ts`（CharacterV2/WorldEntryV2/PlotlineV2/ChoiceNodeV2/ForeshadowEntry 增 `aiSource?: { proposalId: string; cid: string }`——可选、校验器宽容、BOOK_FORMAT 同步）
- Modify: `electron/main/bookStore/adopt.ts`（create 路径：落盘前按 aiSource 扫描目标域既有实体，命中→视为已应用（计入 applied、不新建、不双胞胎）；写入时注入 aiSource={proposalId,cid}；update/delete 不注入不改）+ test
- Modify: `docs/BOOK_FORMAT.md`（aiSource 字段 + 「第三方手写实体请勿伪造 aiSource」一句 + M4c-1 minor 1 的「勿事后增删 cid」警示）
- Test: adopt.test.ts 增：markSettled-mock 抛穿→重试同批→listCharacters 计数不变（双胞胎关窗判别）；aiSource 命中跳过；手写实体无 aiSource 不受影响

- [ ] Steps: TDD（先写双胞胎 RED——当前实现重试确实双胞胎，M4c-1 已钉为"残留"，本任务把它变 GREEN 关闭）→ 实现 → 全门 → Commit `feat(adopt): idempotent creates via aiSource provenance token`。

### Task 2: 实体→章节引用并集（纯函数）

**Files:**
- Create: `src/common/entityRefs.ts` + `entityRefs.test.ts`
- `buildEntityChapterRefs(args: { index: Record<string,string[]>; characters: CharacterV2[]; world: WorldEntryV2[]; plotlines: PlotlineV2[]; choices: ChoiceNodeV2[]; ledger: ForeshadowLedger; chapterIds: Set<string> }): Record<string, string[]>`——并集去重、剔除不在 chapterIds 的悬挂引用、排序按章 order？（入参无 order——改为接收 `orderedChapterIds: string[]`，输出按该序）；key 域=所有实体 id（角色/词条/剧情线/选项/伏笔）。
- Test：并集/去重/悬挂剔除/空 index（M4b 前状态）/空显式引用（新书）/序保持。

- [ ] Steps: TDD → 实现 → 全门 → Commit `feat(refs): entity-to-chapter reference union (index ∪ explicit)`。

### Task 3: graphModel 三新视图

**Files:**
- Modify: `src/common/graphModel.ts`（+test）：`GraphKind` 扩 `'plotline'|'choice'|'arc'`；`buildPlotlineGraph(plotlines): Graph`（节点=剧情线，sub=status 中文；边=stages 顺序链 stage_i→stage_{i+1}，label=stage.title；布局=每剧情线一列、stage 纵向）；`buildChoiceGraph(choices): Graph`（节点=选项，sub=章序提示无则空；边=同章多选项间虚线？裁定：无边的散点图+按章分列布局，边仅当 choice 有 consequence 指向另一 choice id 时——M2 schema 无此字段，故 M4c 选择图=按章分列的节点集合，edges=[]，文档说明）；`buildArcGraph(chars, selectedId): Graph`（节点=该角色 arc stages 纵向链+角色根节点；边=stage 链；布局单列）；ROLE/CATEGORY 色复用+新 STATUS_COLORS（plotline active/done/dormant 三色，var token）。
- Test：三 builder 的退化输入（空/单节点/stage 无 chapterIds）、布局不重叠、determinism。

- [ ] Steps: TDD → 实现 → 全门 → Commit `feat(graph): plotline/choice/arc graph builders`。

### Task 4: GraphView 五视图 + 跳章节

**Files:**
- Modify: `src/renderer/components/Graph/GraphView.tsx`（kind 选择器五档；arc 档显示角色 Select（characters 列表，默认主角 role 优先）；数据源按 kind 分派 builder；节点点击→onNodeClick 语义扩展：新 prop `onJumpChapters?: (entityId, kind) => void` 由 Workspace 提供——GraphView 内点击先查 refs（useGraphData 已拉的数据+readAiData index 经 useAiData）：有引用→弹出章节菜单（antd Dropdown/Modal 列表「第 N 章 标题」）选中→onJumpToChapter(chapterId)；无引用→回退 onNodeClick（M3 切面板））
- Modify: `src/renderer/pages/Workspace/hooks/useGraphData.ts`（加拉 plotlines/choices/ledger——既有通道）
- Modify: `Workspace/index.tsx`（onJumpToChapter：openChapter by id（session 有 openChapter(chapter)——需 chapters 列表查对象）+ 切回写作视图）
- 空态五档文案；arc 无选中角色时提示选择
- Test：无（渲染层）；CDP 冒烟清单入报告

- [ ] Steps: 实现 → 全门 → Commit `feat(graph): five graph views with chapter-jump menu`。

### Task 5: 叙事录入面板（侧栏第五 tab）

**Files:**
- Create: `src/renderer/components/Explorer/NarrativePanel.tsx`（Segmented 剧情线/关键选项/伏笔；每段 List+Modal 表单：plotline{title,summary,status}+stages 编辑器（增删行 title/summary）；choice{title,chapterId Select, options 行编辑 label/consequence}；foreshadow 台账表{title,planted Select,status 操作按钮 回收/弃置/重开（走 resolve/abandon/reopen 通道）,resolved 章显示}）
- Modify: `SidebarPanel.tsx`（tab 增 'narrative'，图标 NodeIndex/分支类）、`Workspace`（sidebarTab 类型扩）、`useIPC`（已有 useNarrative——核对六函数齐）
- 错误中文映射（REF_BROKEN/FORESHADOW_TRANSITION/CHOICE_INVALID 等经通道 message 原样+前缀映射表同 aiErrorText 姿态，放 narrativeErrors.ts 单源）
- Test：无（渲染层）；冒烟清单入报告

- [ ] Steps: 实现 → 全门 → Commit `feat(narrative): plotline/choice/foreshadow authoring panel`。

### Task 6: viewState + 取消 UI + 结转小批

**Files:**
- Modify: `MonacoEditor.tsx`（handle 增 `saveViewState(): unknown | null` / `restoreViewState(v): void` 包装 monaco API）+ `Workspace/index.tsx`（viewMode 切换前存、切回后 restore；ref 持有）
- Modify: `useOrganize.ts` + EditorToolbar（organizing 中按钮变「取消」→ ai:cancel(requestId)；取消后 toast「已取消整理」）
- 结转小批：ChapterTree/VolumeManager/AiSettingsSection 静态 message.*→App.useApp；proposal.ts validateChange 拒 cid 以 `idx:` 开头（+测试）；changeKey trim 归一（+测试）；PROPOSAL_* 中文映射表（renderer services，同 aiErrorText 姿态）；narrow-gate（foreshadow/summary/index update）未知键改拒（adopt.ts 三处+测试，与 character/world 口径统一）；e2e-organize 剧本加一条 overwritesHuman 变更；面板 aiTouched 注记限定「角色/设定」措辞
- Test：上述纯逻辑项各钉

- [ ] Steps: 实现 → 全门 → Commit `feat(ux): editor view-state across view switch, organize cancel, carryover cleanup`。

### Task 7: 文档 + 收尾 + CDP 总冒烟

**Files:**
- Modify: `README.md`（叙事面板/五视图/跳章节特性行）、`docs/DEVELOPMENT.md`（M4c-2 行+真实测试数）、`docs/BOOK_FORMAT.md`（若 T1 外还有字段变动对表）
- Create: `docs/superpowers/plans/2026-10-28-m4c2-closeout.md`（裁定全集：choice 图无边裁定、arc 选择器默认主角、跳转空引用回退、narrow-gate 统一、viewState 方案选型；结转：settled 历史视图、quote 软校验、TTFB 分段计时、aiModel capture-at-send、mask 9 字符、usage 轮转、M3 图谱写交互/拖拽）
- CDP 总冒烟（强制，证据入报告）：五视图逐个渲染（演示书需先经面板造 1 剧情线 2 stages、1 选项、2 伏笔）→ arc 选角色 → 节点点击跳章节菜单→跳转→编辑器光标在该章 → 叙事面板 CRUD 往返 → 整理取消按钮在途可见可点 → viewState：写作第 5 行光标→切图谱→切回光标仍在 → 零 console 错误

- [ ] Steps: 冒烟先行（抓真机缺陷）→ 文档 → 全门 → Commit `feat(m4c2): narrative UI + five graph views closeout`。

---

## M4c-2 DoD

- 双胞胎窗关闭（T1 判别测试 GREEN）；五视图+跳章节+叙事面板真机冒烟全过；viewState 恢复实证。
- 结转小批清零（清单内全部）；BOOK_FORMAT/README/DEVELOPMENT 与代码零漂移。
- 全门绿；发起人最终统一手动验证清单（含本里程碑新增项）写入 closeout。
