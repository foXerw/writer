# M5 实时补全（ghost text）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 写作编辑器内 opt-in 的流式 ghost text 补全：停笔浮现灰字、Tab 采纳已到达部分、设定卡优先依据、默认关闭、账本记 completion。

**Architecture:** 触发=纯状态机（common）+ 渲染层 debounce 时钟；上下文=光标前正文窗+引用实体卡投影（entityRefs 并集反查）经**旁建的 completion 专用装配器**（organize 装配器 ai-context.ts 一字不动）；传输复用 `ai:chat` 通道（feature='completion'，models.completion 槽 chatService 已解析）；ghost=Monaco 单 decoration `after.content` 流式更新；dismiss 即 `cancel(requestId)`。

**Tech Stack:** 既有栈（Electron+React+TS+Monaco 0.55.1），零新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-31-m5-realtime-completion-design.md`（已批准；含发起人拍板 7 条与控制器拍板清单）。

## Global Constraints

- 零新增运行时依赖；不新增 IPC 通道（复用 `ai:chat`/`ai:cancel`/既有 ai settings 与实体读通道；如改判必须报告并记录理由）。
- 新 UI 全中文；token 化样式（var(--color-*)）；无 !important 新账。
- React 组件层无单测（无 jsdom）；**纯逻辑必须单测**（T1/T2/T3/T5 的纯函数）。
- 门禁沿用：typecheck 0 入 build / lint 0 error（1 既有 warning 可）/ vitest 全绿不回退（基线 757）/ build。
- 开关默认关；写作流内任何补全错误**静默 no-suggest**（console.warn 仅），绝不 toast。
- IME 组字期间绝不触发/采纳（compositionstart 即撤）。
- 每任务一提交带 Co-Authored-By: Claude Code <noreply@anthropic.com>。

## Review Focus

1. **IME 组字中停笔**→不请求不弹（compositionstart 撤 arm）；T2 转移表钉 + T6 冒烟 dispatchEvent 复验。
2. **修订态（光标后有余文）**→不请求；T2 钉 suffix 非空抑制 + T6 冒烟段中停笔无 ghost。
3. **坏配置/断网/超时**→静默无 ghost、无 toast、console.warn 单条；T5 `completionSilentKinds` 全 kind 钉 + T6 断 baseUrl 冒烟。
4. **流到一半 Tab**→只采纳已到达文本，其后 chunk 不得追加（accept 后同 requestId chunk 为 no-op）；T2 钉 accept-后-chunk + T6 冒烟早 Tab。
5. **流中切章/切视图**→abort+清 ghost，新章不得见旧 ghost；T2 钉 viewSwitch/chapterSwitch 转移 + T6 冒烟。

---

### Task 1: completion 上下文装配器（纯）

**Files:**
- Create: `src/common/completionContext.ts` + `src/common/completionContext.test.ts`
- 消费: `src/common/schema.ts`（CharacterV2/WorldEntryV2 字段）、`src/common/entityRefs.ts`（`buildEntityChapterRefs(args): Record<string, string[]>`）

**Interfaces:**
- Produces:
  - `projectCharacterCard(c: CharacterV2): string` — `name（role）：appearance／personality／background` 各截断 80 字，空字段跳过。
  - `projectWorldCard(w: WorldEntryV2): string` — `name（category）：content` 截断 120 字。
  - `entitiesForChapter(refs: Record<string, string[]>, chapterId: string): string[]` — 反查：refs 中 value 含 chapterId 的 key 集，按 key 字典序（确定性）。
  - `buildCompletionPrompt(args: { proseBefore: string; proseAfter: string; cards: string[]; bookName: string; synopsis: string; maxChars: number }): { system: string; user: string }` — system 骨架=散文写手人格：「你是本书的合写者…优先依据给出的设定卡描写；无卡时依正文语气自由续写，但不得与已给设定矛盾；只输出接续正文，不解释不引用标记」；user = `【书名】…【梗概】…【相关设定】cards.join('\n')…【正文·光标前】proseBefore 尾 maxChars 字…【光标后余文】proseAfter 头 200 字（可为空）…请接续光标处写 ≤3 句（≤120 字），遇段落意思完整即停。`
- Consumes: 无前置任务产物。

- [ ] Step 1: 写失败测试（projection 截断/空字段跳过；entitiesForChapter 反查+字典序；prompt 结构断言：cards 块在 prose 块前、含「无卡时…自由续写」句、proseBefore 超 maxChars 只留尾部、proseAfter 截 200）
- [ ] Step 2: 跑 `npx vitest run src/common/completionContext.test.ts` 期望 FAIL
- [ ] Step 3: 实现三函数+builder（截断用既有字符串工具若无则本地 slice 按码点）
- [ ] Step 4: 跑测试期望 PASS；跑 `npm run typecheck`
- [ ] Step 5: Commit `feat(completion): context assembler with card projection and chapter ref inversion`

### Task 2: 触发状态机（纯）

**Files:**
- Create: `src/common/completionTrigger.ts` + `src/common/completionTrigger.test.ts`

**Interfaces:**
- Produces:
  - `type CompletionState = { phase: 'idle'|'armed'|'requesting'|'streaming'; composing: boolean; cooldownUntil: number; lastPrefix: string }`
  - `type CompletionEvent = { type: 'contentChanged'; prefix: string; suffixEmpty: boolean; at: number } | { type: 'cursorMoved'; suffixEmpty: boolean } | { type: 'pauseTick'; at: number } | { type: 'compositionStart' } | { type: 'compositionEnd' } | { type: 'requestSent' } | { type: 'firstChunk' } | { type: 'chunk' } | { type: 'accept' } | { type: 'dismiss'; at: number } | { type: 'chapterSwitch' } | { type: 'viewSwitch' } | { type: 'disabled' }`
  - `nextCompletionState(s: CompletionState, e: CompletionEvent, cfg: { enabled: boolean; debounceMs: number; cooldownMs: number }): { state: CompletionState; fire?: 'request'|'abort' }` — 规则：enabled=false 或 composing=true 或 suffixEmpty=false → 永不 fire request（armed 也撤）；contentChanged→armed（记 prefix）；pauseTick 且 armed 且 at-lastChange≥debounce 且 suffixEmpty 且 !composing 且 at≥cooldownUntil 且 prefix≠lastPrefix（同前缀冷却）→ fire request + phase requesting；requestSent→requesting；firstChunk→streaming；chunk 在 streaming=no-op、在 accepting 后（phase idle）=no-op；accept/dismiss→idle（dismiss 记 cooldownUntil=at+cooldownMs、lastPrefix=prefix）；chapterSwitch/viewSwitch→fire abort（若 requesting/streaming）+idle；compositionStart→composing=true 且若 requesting/streaming fire abort。
  - `initialCompletionState(): CompletionState`
- Consumes: 无。

- [ ] Step 1: 写失败测试=Review Focus 1/2/4/5 的转移断言+冷却+composing 撤 arm+accept-后-chunk no-op（≥14 例转移表）
- [ ] Step 2: 跑测试期望 FAIL
- [ ] Step 3: 实现 reducer
- [ ] Step 4: 跑测试 PASS + typecheck
- [ ] Step 5: Commit `feat(completion): pure trigger state machine with IME/revision/cooldown guards`

### Task 3: 补全开关（默认关）

**Files:**
- Modify: `src/common/ai-types.ts`（AiSettings/AiSettingsView +`completionEnabled: boolean`；load 默认 false 的迁移注释）、`electron/main/ai/settings.ts`（loadSettings 缺省补 false、toSettingsView 透出、saveSettings patch 接受）、`src/renderer/components/Settings/AiSettingsSection.tsx`（Switch 行「写作补全（默认关）」+ 说明文案）、test: `electron/main/ai/settings.test.ts` 或既有 ai settings 测试文件增例

**Interfaces:**
- Produces: `AiSettingsView.completionEnabled: boolean`（渲染层经 `useIPC().getAISettings()` 读，既有通道）。
- Consumes: 既有 ai settings patch 通道（electron/main/ipc/modules/ai.ts saveSettings(patch)）。

- [ ] Step 1: 失败测试：旧设置文件（无该键）load → completionEnabled=false；patch {completionEnabled:true} 往返；toSettingsView 透出
- [ ] Step 2: 跑 FAIL
- [ ] Step 3: 实现 schema+store+view+UI Switch（中文 label+tooltip：停笔浮现灰字，Tab 采纳，Esc 撤）
- [ ] Step 4: 测试 PASS + typecheck + lint
- [ ] Step 5: Commit `feat(completion): opt-in switch defaulting off in AI settings`

### Task 4: Monaco ghost 层 + 键位 + carry-in

**Files:**
- Modify: `src/renderer/components/Editor/MonacoEditor.tsx`（handle 增 `setGhost(text: string): void` / `clearGhost(): void` / `getGhost(): string` / `getProseWindow(): { before: string; after: string; cursorOffset: number }`（model.getValue 按 cursor offset 切片，码点安全）/ `insertAtCursor(text: string): void`（executeEdits，保留 undo 栈）；props 增 `onAcceptGhost?: () => void` / `onDismissGhost?: () => void`；Tab 键位：getGhost() 非空→onAcceptGhost 且 return（否则默认缩进）；Esc：有 ghost→onDismissGhost；compositionstart 监听→props `onCompositionStart?: () => void`；ghost decoration=光标位单 decoration `after:{ content: ghost, inlineClassName: 'completion-ghost' }` 流式 setGhost 只更新该 decoration）、`src/renderer/styles/global.css`（`.completion-ghost { color: var(--color-text-tertiary); opacity:.75 }` 双主题天然经 token）、**carry-in**：unicodeHighlighting 增 `includeComments: true`（闭合注释域盲区；ambiguous/nonBasic 仍 false）
- Test: 无（组件层）；T6 冒烟覆盖

**Interfaces:**
- Produces: handle 三方法+三 props 回调（T5 消费）。
- Consumes: 无前置。

- [ ] Step 1: 实现 handle/props/decoration/CSS/carry-in（注释写明 decoration 单实例复用、stream 更新不重建 editor）
- [ ] Step 2: typecheck + lint + vitest 全量（757 不回退）+ build
- [ ] Step 3: 手工自检：dev 起、编辑器里 console 调 handle.setGhost('测试灰字') 见灰字、getGhost 回读、clearGhost 消失（截图存 .superpowers/tmp/m5-t4-ghost.png）
- [ ] Step 4: Commit `feat(completion): monaco ghost decoration layer with Tab/Esc/IME hooks`

### Task 5: useCompletion 编排 hook + Workspace 接线

**Files:**
- Create: `src/renderer/pages/Workspace/hooks/useCompletion.ts` + `useCompletion.test.ts`（纯切片与静默策略）
- Modify: `src/renderer/pages/Workspace/index.tsx`（挂载 hook、把 enabled/getGhost 回调/回调们传给 MonacoEditor；chapterSwitch/viewSwitch 事件喂状态机）

**Interfaces:**
- Consumes: T1 `buildCompletionPrompt/entitiesForChapter`、T2 `nextCompletionState/initialCompletionState`、T4 handle（`getProseWindow/insertAtCursor/setGhost/clearGhost/getGhost`）+props、`useAI().chat/cancel`（`chat(req: Omit<AiChatRequest,'requestId'>, { onChunk, onDone, onError }): Promise<string>`）、`useIPC().getAISettings()`、实体读通道（useCharacter/useSetting 既有 hook 或 ipc character/world getAll——照 NarrativePanel 现状选）、`buildEntityChapterRefs`。
- Produces（hook 内纯函数，单测）:
  - `sliceProseBefore(full: string, cursorOffset: number, maxChars: number): string`（光标前尾 maxChars 码点）
  - `completionSilentKinds: readonly AiErrorKind[]`（全 kind——策略表，onError 只 console.warn）
- 编排：enabled=getAISettings().completionEnabled（设置变更经既有 fs.watch? 无——每次 arm 前重读一次 getAISettings，毫秒级可接受）；debounce 900ms 定时器驱动 pauseTick；fire request→装配（sliceProseBefore + entitiesForChapter(refs, currentChapterId) 反查卡投影 + 书名/梗概）→ chat({feature:'completion', messages:[system,user], maxTokens: 300})；onChunk 首块=firstChunk 且 setGhost(累计文本)，后续 chunk 累加 setGhost；4s 无首块→cancel+dismiss；onError→silent；accept=editor 插入 getGhost() 文本（executeEdits 由 T4 Tab 路径触发 onAcceptGhost→hook 提供插入实现）后 dismiss 语义但不进冷却（采纳不是拒绝：cooldown 不记）；dismiss→cancel(requestId)+clearGhost。

- [ ] Step 1: 失败测试：sliceProseBefore 码点边界/空文/光标 0；completionSilentKinds 覆盖 AI_FEATURES 错误 kind 全集（对照 useAI KIND 表）
- [ ] Step 2: 跑 FAIL
- [ ] Step 3: 实现纯函数+hook+Workspace 接线（注释写明：arm 前重读设置、accept 不进冷却、stream 期切章 abort）
- [ ] Step 4: 测试 PASS + 四门全跑
- [ ] Step 5: Commit `feat(completion): useCompletion orchestration with silent-failure policy`

### Task 6: 真 key CDP 冒烟 + 文档收尾

**Files:**
- Create: `.superpowers/tmp/cdp-m5-smoke.mjs`（gitignored；仿 cdp-m4c2 驱动）
- Modify: `README.md`（补全特性行）、`docs/DEVELOPMENT.md`（M5 行+真实测试数）、Create `docs/superpowers/plans/2026-10-31-m5-closeout.md`（裁定全集：流式拍板/修订态不弹/无 POV 字段/装配器分叉/角色卡投影/includeComments carry-in；结转：多候选循环、改稿召唤键、quote 软校验等既有池+本批 minors）

**冒烟清单（证据入报告）:** 设置页开补全开关（真 key 已在 userData）→ 章尾输入意图行「她推门踏入沉渊阁。」停笔 → ≤2.5s 灰字流式浮现 → 早 Tab=只采纳已到达 → 再触发一次 Esc 撤 → 段中光标停笔无 ghost → dispatchEvent compositionstart 期间停笔无 ghost → 断 baseUrl 重触发=静默无 ghost 无 toast（console.warn 单条）→ 流中切章=ghost 清且新章无旧 ghost → usage.jsonl 末行 feature=completion 且 model=completion 槽值 → 零应用级 console 错误。

- [ ] Step 1: 冒烟先行（缺陷即修，小修单独 commit）
- [ ] Step 2: 文档三处+closeout
- [ ] Step 3: 四门全跑（测试数入 DEVELOPMENT）
- [ ] Step 4: Commit `feat(m5): realtime completion closeout`

---

## M5 DoD

- 开关默认关；开启后起草流停笔浮现、Tab/Esc/IME/修订态/切章语义全按 spec；账本 completion 分账可见。
- organize 装配器与 M4b 回归零变动（37 测试原样绿）。
- 真机冒烟全过+零应用级 console 错误；BOOK_FORMAT 无字段变动（本里程碑零 schema 数据字段新增——completionEnabled 属设置非书数据）。
