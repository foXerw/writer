# M6 章节审阅实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 工具栏一键审阅：AI 读者视角对当前章（可选连续多章）出段落锚定的结构化意见单（硬对账+软感受），硬意见一键转提案（含并入未消化提案的 additive 路径），意见跨会话存续、重审按章替换、dismissed 同章抑制。

**Architecture:** 意见纯文件账 `.ai/reviews/<chapterId>.json`（每章一文件，按章替换原子化）经新 `review:*` CRUD 通道；AI 流量复用 `ai:chat`+feature='review'（逐章 N 次顺序调用）；审阅专用装配器（正文全文不截断+卡带 id+台账 open 清单）；转化=纯映射函数产出 ProposalChange 走既有 `proposal:save` 或**新增 additive `proposal:appendChanges`**（尾部追加、cid 盖章、DUPLICATE 闸门不动）。

**Tech Stack:** 既有栈，零新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-31-m6-chapter-review-design.md`（已批准；发起人拍板 5 条+控制器拍板全集）。

## Global Constraints

- 零新增运行时依赖；AI 流量复用 `ai:chat`+feature 标签；**新增 `review:*` CRUD 通道为本里程碑明文许可**（渲染层无 fs）；不新增书数据 schema 字段（reviews 属 `.ai/` 账）。
- 新 UI 全中文；token 化样式；无 !important 新账；React 组件层无单测（无 jsdom），**纯逻辑必须单测**。
- 门禁沿用：typecheck 0 入 build / lint 0 error（1 既有 warning 可）/ vitest 全绿不回退（基线 820）/ build。
- 审阅绝不写散文/写数据域文件；转化只产提案（人确认流水线不变）。
- 审阅失败在对话框内可见报错（主动操作语义；区别于补全静默）。
- 范围上限连续 5 章；预算硬顶按单请求计，超顶 UI 拒绝并提示收窄。
- 每任务一提交带 Co-Authored-By: Claude Code <noreply@anthropic.com>。

## Review Focus

1. **锚漂移**：审后改正文→重定位或显式「锚已失」灰态，绝不错位高亮；T1 relocateAnchor 三态测试 + T6 冒烟（改章后开审阅）。
2. **dismissed 复读**：重审不得重现同章已驳回意见（抑制键=chapterId+类别+锚哈希）；T1 saveRun 矩阵钉 + T6 冒烟（驳回→重审）。
3. **append 完整性**：并入未消化提案时既有 cid/位置键稳定、闸门不放宽、坏形状整拒零写；T3 RED-first + T6 冒烟（pending 存在时转化）。
4. **部分失败按章提交**：3 章跑第 2 章失败→1/3 照落、2 保留旧意见+按章报错；取消=已完成章留存；T1 每章独立文件 + T5 循环逐章 saveRun + T6 冒烟（流中取消）。
5. **审阅零写数据**：转化路径只返回 change/只写提案文件；T4 纯函数无 fs + T6 冒烟（转化后 ledger/world 文件字节不变直至采纳）。

---

### Task 1: 意见 schema + reviews 仓库 + review:* 通道 + 锚重定位（纯+主进程）

**Files:**
- Create: `src/common/reviewTypes.ts` + `reviewTypes.test.ts`；`electron/main/bookStore/reviews.ts` + `reviews.test.ts`；`electron/main/ipc/modules/reviews.ts`
- Modify: `src/common/ipc.ts`（RendererToMainRequests 增 4 通道+facade 类型）、`electron/preload/index.ts`（facade 实现）、facade 聚合处（照 proposal 模块先例）

**Interfaces:**
- Produces:
  - `type ReviewCategory = 'foreshadow-unresolved'|'setting-conflict'|'motivation-break'|'pacing'|'flatness'|'prose-craft'`；`HARD_CATEGORIES`/`SOFT_CATEGORIES` 常量表。
  - `interface ReviewOpinion { id: string; chapterId: string; category: ReviewCategory; severity: 'hard'|'soft'; anchor: { quote: string; paraIndex: number }; text: string; suggestion?: string; targetEntityId?: string; status: 'open'|'dismissed'|'converted'; stale: boolean; createdAt: string; model: string; proposalId?: string }`
  - `validateReviewOpinion(v: unknown): string[]`（宽容读、严格写自家产物同 proposal 先例）。
  - `suppressionKey(o: {chapterId, category, anchor}): string`（chapterId+category+normalizeQuote 哈希；normalizeQuote=去所有空白+全角 ASCII 转半角）。
  - `relocateAnchor(body: string, anchor: {quote, paraIndex}): { found: true; paraIndex: number; startOffset: number; endOffset: number } | { found: false }`（先按 paraIndex 段内找 normalize 后引文，失败则全文搜；段按 `\n\n` 切，同 organizePrompt R15 先例）。
  - 仓库：`loadReviews(projectPath, chapterId): ReviewOpinion[]`（缺文件=[]）；`saveRun(projectPath, chapterId, opinions: ReviewOpinion[], model): ReviewOpinion[]`（合并矩阵：旧 dismissed/converted 保留；旧 open 与新同抑制键→被新替换；旧 open 未重现→保留且 stale=true；新意见命中旧 dismissed 抑制键→丢弃；返回合并后全集）；`dismissReview(projectPath, chapterId, opinionId)`；`markReviewConverted(projectPath, chapterId, opinionId, proposalId)`。
  - 通道：`review:get({projectPath, chapterId?})` / `review:saveRun({projectPath, chapterId, opinions, model})` / `review:dismiss(...)` / `review:markConverted(...)`。
- Consumes: 无前置。

- [ ] Step 1: 失败测试：schema 校验（status 三值+stale 布尔钉死、六类白名单）；suppressionKey 稳定+跨章不抑制；relocateAnchor 三态（段内命中/跨段全文命中/缺失）；saveRun 合并矩阵四路+部分写零污染
- [ ] Step 2: 跑 FAIL
- [ ] Step 3: 实现纯函数+仓库+通道（文件形态 `.ai/reviews/<chapterId>.json` 单文件 JSON 数组，人可读缩进 2）
- [ ] Step 4: 测试 PASS + typecheck + lint
- [ ] Step 5: Commit `feat(review): opinion schema, per-chapter review store, review IPC channels`

### Task 2: 审阅装配器 + 结果解析（纯）

**Files:**
- Create: `src/common/reviewContext.ts` + `reviewContext.test.ts`

**Interfaces:**
- Produces:
  - `buildReviewPrompt(args: { bookName: string; synopsis: string; chapters: { id: string; title: string; body: string }[]; cards: string[]; openForeshadow: string[]; maxTokens: number }): { kind: 'ok'; system: string; user: string } | { kind: 'over-budget'; estimated: number }`——正文**全文不截断**（锚必原文）；cards 行带实体 id（`[id] name（role）：…` 投影复用 M5 completionContext 投影函数+id 前缀）；openForeshadow=台账 open 条目清单（伏笔对账依据）；system=读者视角人格+六类词典（每类一句判定标准）+输出信封契约 `{opinions:[{category,severity,anchor:{quote,paraIndex},text,suggestion?,targetEntityId?}]}`+「quote 必须逐字取自正文」「硬意见尽量给 targetEntityId」。
  - `type ParsedOpinion = Omit<ReviewOpinion, 'id'|'createdAt'|'model'|'status'|'stale'>`
  - `parseReviewOpinions(raw: string, chapterId: string): { kind: 'ok'; opinions: ParsedOpinion[] } | { kind: 'parse-failed' }`（信封校验走 validateReviewOpinion；quote 不在正文**不丢弃**（渲染期 relocate 决「锚已失」）；chapterId 由调用方按章注入；**id/createdAt/model/status/stale 五字段由 T5 编排盖章**——纯函数不碰时钟与随机）。
- Consumes: T1 类型与 validate；M5 `completionContext` 投影函数。

- [ ] Step 1: 失败测试：over-budget 判定（估算=正文码点/2 启发式，builder 可换但钉死一处）；六类词典入 system；cards 带 id；parse 信封/坏类/缺锚字段/quote 幻觉保留四路
- [ ] Step 2: 跑 FAIL
- [ ] Step 3: 实现
- [ ] Step 4: 测试 PASS + typecheck
- [ ] Step 5: Commit `feat(review): full-body context assembler and opinion envelope parser`

### Task 3: proposal:appendChanges additive 引擎操作

**Files:**
- Modify: `electron/main/ipc/modules/proposal.ts`（新 handler）、`src/common/ipc.ts`+preload（通道+facade）、`electron/main/bookStore/adopt.ts` 或 proposal 存储层（append 实现落点随现有 writeProposal/listProposals 所在文件）
- Test: `electron/main/bookStore/adopt.test.ts` 或 proposal 既有测试文件增节

**Interfaces:**
- Produces: `proposal:appendChanges({ projectPath, proposalId, changes: ProposalChange[] }): Promise<ProposalFile>`——目标文件必须存在且 `isUnsettled`（否则拒 `PROPOSAL_APPEND_TARGET: <id>`）；每条 change 过 `validateChange`（任一坏=整拒零写）；cid 缺省盖 randomUUID；**尾部追加**（既有 cid 与位置键稳定）；`proposal:save` 的 DUPLICATE 闸门一字不动。
- Consumes: 既有 `listProposals/writeProposal/validateChange/isUnsettled`。

- [ ] Step 1: 失败测试：append 到 unsettled=cid 盖章+尾部+既有键稳定+返回全文；append 到 settled/缺文件=拒且盘不变；坏形状整拒零写；save 闸门回归（同章第二份仍拒）
- [ ] Step 2: 跑 FAIL
- [ ] Step 3: 实现 handler+通道+facade
- [ ] Step 4: 测试 PASS + 四门
- [ ] Step 5: Commit `feat(proposal): additive appendChanges for review-converted opinions`

### Task 4: 意见→提案 change 转化映射（纯）

**Files:**
- Create: `src/common/reviewConvert.ts` + `reviewConvert.test.ts`

**Interfaces:**
- Produces: `opinionToChange(o: ReviewOpinion, ctx: { characters: CharacterV2[]; world: WorldEntryV2[] }): { kind: 'ok'; change: ProposalChange } | { kind: 'need-target'; candidates: { id: string; name: string }[] } | { kind: 'invalid'; reason: string }`——映射：foreshadow-unresolved→`{op:'create', entity:'foreshadow', after:{title: 截 30 字意见摘要, plantedChapterId: o.chapterId, status:'open'}}`（无 target 需求）；setting-conflict→world update（target= o.targetEntityId 校验存在且为 world，after=既有卡 content 追加 suggestion 段）；motivation-break→character update（target 校验为 character，after=既有卡 goals/flaws 追加 suggestion）；targetEntityId 缺/无效→need-target（candidates=对应域全列表 name 序）；软意见→invalid('soft-not-convertible')。
- Consumes: T1 类型、schema 实体类型。

- [ ] Step 1: 失败测试：三映射形状+after 构造不丢既有字段；target 校验两路；need-target candidates 预滤；软意见 invalid
- [ ] Step 2: 跑 FAIL
- [ ] Step 3: 实现
- [ ] Step 4: 测试 PASS + typecheck
- [ ] Step 5: Commit `feat(review): opinion-to-proposal-change mapping with target fallback`

### Task 5: 审阅对话框 + 工具栏入口 + 跳转高亮 + useReview 编排

**Files:**
- Create: `src/renderer/components/Dialogs/ReviewDialog.tsx`、`src/renderer/pages/Workspace/hooks/useReview.ts`
- Modify: `src/renderer/components/Editor/EditorToolbar.tsx`（审阅按钮+未处理徽标）、`src/renderer/components/Editor/MonacoEditor.tsx`（handle 增 `revealAndHighlight(startOffset, endOffset): void` / `clearReviewHighlight(): void`——临时 decoration 类 `.review-highlight` token 色）、`src/renderer/pages/Workspace/index.tsx`（接线）、`src/renderer/styles/global.css`（高亮类）

**Interfaces:**
- Consumes: T1 通道与 relocateAnchor、T2 build/parse（**parse 返回 ParsedOpinion，本任务盖 id=randomUUID/createdAt=now/model=实发/model 槽解析值/status='open'/stale=false 后再 saveRun**）、T4 opinionToChange、T3 appendChanges、`useAI().chat/cancel`、`useIPC` 实体读与 proposal:getAll/save。
- 编排：范围选择（默认当前章；多选连续章 ≤5）→ 逐章顺序 chat(feature='review')，每章成功即 `review:saveRun`（部分失败隔离）→ 对话框按章分节流式呈现意见（硬/软分组、severity 色 token）；取消=停循环+cancel 在途；每章错误节可见+重试按钮；意见动作：跳转（relocateAnchor found→revealAndHighlight，found:false→灰「锚已失」禁跳转）、驳回（review:dismiss）、转化（仅 hard+open：opinionToChange ok→查 proposal:getAll 该章 unsettled：无→proposal:save 新文件（changes=[change]）/有→proposal:appendChanges；need-target→选择器 Modal（candidates）回填重走；转化成功→review:markConverted+提案徽标提示）；软意见仅驳回。
- 预算：装配 over-budget→对话框拒绝并提示收窄范围（不发起）。

- [ ] Step 1: 实现（无组件单测；纯逻辑已在 T1-T4）
- [ ] Step 2: 四门全跑
- [ ] Step 3: CDP 手工自检（dev+9222）：假意见经 review:saveRun 落盘→对话框渲染/跳转高亮/锚已失灰态/驳回持久（截图 m6-t5-*.png，每关键时刻独立帧）
- [ ] Step 4: Commit `feat(review): review dialog, toolbar entry, jump-highlight, useReview orchestration`

### Task 6: 真 key CDP 冒烟 + 文档 + closeout

**Files:**
- Create: `.superpowers/tmp/cdp-m6-smoke.mjs`（gitignored；**run-numbered 日志** cdp-m6-run<N>.log 按结转 8 纪律）
- Modify: `README.md`、`docs/DEVELOPMENT.md`、`docs/BOOK_FORMAT.md`（§7 增 reviews 目录形态节+appendChanges 语义节）、Create `docs/superpowers/plans/2026-10-31-m6-closeout.md`

**冒烟清单（证据入报告，独立帧）:** 审当前章（真 key）→ 意见按章分组流式呈现、硬软分色 → 点硬意见跳段高亮 → 改正文一处使某锚漂移→重开对话框该条「锚已失」灰 → 驳回一条→重审不复现 → 硬意见转化（无 pending）→差异面板见 review 出处条目 → 再造 pending（整理一章不消化）→第二条硬意见转化=并入该提案（差异面板两来源）→ 转化后 ledger/world 文件字节不变（采纳前）→ 三章范围中途取消=已完成章留存+徽标计数对 → 坏配置=对话框内错误节 → 6 章范围=UI 拒绝 → 账本 review 行 model=review 槽值 → 零应用级 console 错误。

- [ ] Step 1: 冒烟先行（缺陷即修，小修单独 commit）
- [ ] Step 2: 文档四处+closeout（裁定全集：1a 并入/2a 角色卡/重审按章/stale 布尔/N 次调用/抑制键含章/git-ignored 划掉/append additive；结转：全书扫查、多人格、导出、DEVELOPMENT:99 残留口径词、monaco 两定律复核等既有池）
- [ ] Step 3: 四门全跑（测试数入 DEVELOPMENT）
- [ ] Step 4: Commit `feat(m6): chapter review closeout`

---

## M6 DoD

- 审阅只读纪律零违反（冒烟字节级证据）；append 不放宽 DUPLICATE 闸门（T3 回归钉）。
- 五 Review Focus 全钉（测试+冒烟双证）；BOOK_FORMAT 两新节与代码零漂移。
- 真机冒烟全过+零应用级 console 错误；发起人清单（真输入法无关本里程碑，改为：意见可读性主观 walkthrough、转化选择器手感、stale 观感）。
