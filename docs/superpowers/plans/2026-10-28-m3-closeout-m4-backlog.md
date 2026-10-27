# M3 收尾记录 & M4 待办清单

日期：2026-10-28 ｜ 分支：feat/m3-graph-view（e000148..8c77114，8 提交）→ 已合并 main
计划：`2026-10-27-m3-graph-view.md` ｜ 规格：`../specs/2026-10-27-m3-graph-view-design.md`

## 交付

- **图谱视图**：主区 `写作|图谱` 切换（M1 renderMainView 接缝兑现）；`人物关系|世界观` 二级切换；React Flow v12 只读画布（平移/缩放，节点自动布局不可拖）。
- **graphModel 纯函数**：径向（度数序+全序 tiebreak）+ 分类分层布局；自环/悬挂/双向/parentId 成环全部安全；23 单测。
- **实时刷新双腿**：外部改动→book:changed（M2 watcher）；应用内面板保存→entityEvents 渲染层发布订阅（终审 FI-1，CDP 实证边数 3→4）。
- **点节点**→侧栏切到对应面板并展开（选中/定位到实体卡=M4，onSelectCharacter 接缝已留）。
- 编辑器分支经 `-U0` diff 证实逐字节未动；graph.css 全量 `.graph-view` 作用域；@xyflow style.css 经逐条核对与 antd 零冲突。
- 门禁：typecheck 0 / lint 0 error / **321 测试** / build ✓。

## 本里程碑裁定（AI 代定设计，发起人授权；均可推翻）

1. **只读画布**：节点拖拽+位置持久化推迟 M4（数据文件是唯一真源，视图位置不进数据；自动布局与手动位置冲突是设计题）。spec §3/§7 已记账。
2. **点击=切面板 tab**，实体卡定位/选中推迟 M4。spec §7 已记账（FI-3）。
3. **切换视图丢 Monaco 光标/滚动**推迟 M4（viewState 保存需动刚修好的编辑器邻域，夜里不冒险）；DEVELOPMENT.md 措辞已修正为精确（内容/脏标记保留）。FI-2。
4. **FI-1 机制选择**：渲染层 pub-sub（entityEvents.ts）而非新增 IPC——不违反"不改通道集合"约束；6/6 成功通知点经独立 grep 穷尽核验。

## 过程记录

- Task 3 的强制 CDP 活体验证抓出 2 个 typecheck/build 全绿看不见的渲染阻断（节点缺 type→自定义节点不命中；v12 受控模式缺 onNodesChange→边不画）——live-verify 制度化自此必要。
- M3 终审抓到 M2 自写抑制与 M3 刷新假设的跨里程碑矛盾（应用内保存不触发 book:changed→图不刷新），且揭穿 Task 2 曾修过一个"幻影问题"（自写回声不存在）——两个单任务审查都因缺跨任务视野而漏过。
- 演示书 `D:/tmp/测试/测试` 遗留一条测试关系边（墨渊—师徒→林昭），是 CDP 验证副产物，无碍。

## M4 待办（AI 维护闭环 + 本清单结转项）

**M4a AI 服务层**：OpenAI 兼容 + Anthropic 原生双协议 adapter；key 存 userData 明文配置（发起人裁定）；流式 IPC；按功能 token 分账账本；分层上下文装配（大纲线+卷梗概+章摘要+涉事实体卡）。
**M4b 整理闭环**：整理本章→结构化差异提案（`.ai/proposals/`）→差异确认 UI→采纳落盘带溯源（章节+原文引用）→实体→章节索引（解锁：点击跳章节、伏笔对账）。
**M4c 录入 UI**：剧情线/关键选项/伏笔台账面板 + 图谱第三~五种视图点亮。
**结转**：Monaco viewState（M3-FI-2）；点节点选中实体（M3-FI-3）；节点拖拽持久化（M3 裁定）；悬挂边 warn-once 聚合；useGraphData 错误态 vs 空态；hasLoadedRef 随 projectPath 重置；数据增长 refit；entityEvents 新 mutation 路径纪律（注释警示非机制强制）；M2 遗留：handlers.ts 去 export、死 on.* 通道、chapter:update 回显 wordCount、统一存在性视图、幽灵非-UUID 档、dayjs 去留、批量回填子系统。
**M4 前必须**：收紧 dev disable-web-security 三开关 + 导出隐藏窗 webPreferences（联网前置）。

## 仍欠人工（发起人醒来）

真机冒烟：图谱两视图渲染/平移缩放/点节点跳面板/面板保存→图刷新/切深浅主题图可读/空书空状态；以及 M1/M2 遗留的 7+3 项清单（见各自 closeout）。
