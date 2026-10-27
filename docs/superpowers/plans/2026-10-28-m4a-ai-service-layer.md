# M4a：AI 服务层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成分层 AI 服务层：安全硬化前置 → 双协议 provider（OpenAI 兼容 + Anthropic 原生）→ 密钥配置（主进程持有、渲染进程只见掩码）→ 按 requestId 的流式通道 → token 分账账本 → 分层上下文装配器（纯函数）。全程假 provider/假 fetch 离线测试，不依赖真实 key。

**Architecture:** AI 一律发生在主进程（`electron/main/ai/`）：settings 读写 userData/ai-settings.json；provider 适配器统一 `chat(req,onChunk)→usage` 接口 + SSE 解析 + 错误分类；chatService 走 `ai:chat/cancel` 命令 + `ai:chunk/done/error` 事件（requestId 隔离、精确反订阅）；usage 以 JSONL 追加进 `<book>/.ai/usage.jsonl`；上下文装配为纯函数（估算裁剪用启发式，真实记账以 provider usage 为准）。渲染进程零接触 key 与网络。

**Tech Stack:** 既有栈；网络用 Node 18+ 全局 fetch（无新依赖）；SSE 手工解析（不引 SDK）。

**Spec:** `docs/superpowers/specs/2026-10-28-m4-ai-loop-design.md`（实现其 G1-G5、G8、§4 选择、§7 DoD；G6/G7 属 M4b 不在本计划）

## Global Constraints

- **零新增运行时依赖**（fetch 原生、SSE 手解）。
- **T1 安全硬化必须先于任何网络代码合入**（G8 硬约束）：移除 dev 三开关（disable-web-security / allow-running-insecure-content / allow-file-access-from-files），导出隐藏窗显式 `webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}`。
- apiKey 只存 userData/ai-settings.json（主进程读写）；`ai:getSettings` 返回**掩码**（如 `sk-…abcd` 后 4 位），完整 key 永不回渲染；`ai:setSettings` 传空串=不修改旧 key。
- 门面仍单一 `window.novelWriter`；新通道组：`ai:getSettings/setSettings/testConnection/chat/cancel/getUsage` + 事件 `ai:chunk/ai:done/ai:error`。
- 未配置（无 key 或无 baseUrl+protocol）：`ai:chat` 直接回 `not-configured` 错误，UI 入口置灰引导，不抛崩。
- 账本记录不含任何请求正文/响应正文（只 ts/feature/model/token 计数——隐私姿态写进 BOOK_FORMAT）。
- 全部门禁沿用：typecheck 0（入 build）/ lint 0 error（1 既有 warning 容忍）/ vitest 全绿 / build ok；每任务一提交带 Co-Authored-By。
- 现状基线：main=M3 后，vitest 321。

## Review Focus

1. **安全硬化后应用仍完好**：dev 加载（vite/monaco/HMR）、PDF 导出（file:// 隐藏窗）——T1 必须 CDP 活体验证，不能只看 build。
2. **key 泄漏面**：任何通道返回值/日志/错误消息/e2e 断言里出现完整 key = Critical；错误透传 provider 响应体时须截断且不含 Authorization 回显。
3. **流式通道生命周期**：done/error 后无残留监听；cancel 幂等；两请求并发（不同 requestId）chunk 不串台（T4 测试钉）。
4. **SSE 解析健壮性**：跨 chunk 边界的不完整行、`[DONE]`、[DONE] 前 usage 行、anthropic 的 message_stop 前 usage——假 fetch 流 fixture 覆盖。
5. **上下文预算红线**：装配器任何路径不得把"非当前章的整章正文"或"全部实体卡"塞进输出（spec §7.4）；T5 测试含"预算极小"极端用例。

---

### Task 1: 安全硬化（G8，先于一切网络代码）

**Files:**
- Modify: `electron/main/index.ts`（删 import.meta.env.DEV 三开关块）
- Modify: `electron/main/ipc/modules/export.ts:100`（隐藏窗显式安全 webPreferences）
- Test: 无新增单测（纯配置删除）；**CDP 活体验证强制**

**Interfaces:** 无新接口；行为面=dev 启动不再 appendSwitch。

- [ ] Step 1: 删三开关；导出窗 `new BrowserWindow({show:false, webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true}})`。
- [ ] Step 2: `npm run typecheck && npm run lint && npm run test && npm run build` 全绿。
- [ ] Step 3: **CDP 活体验证**（`npm run dev -- -- --remote-debugging-port=9222`，脚本放 .superpowers/）：(a) 窗口加载、Home 渲染、开书→编辑器可输入（复用 M3 探针套路）；(b) 经门面直调 `window.novelWriter.export.pdf({chapters:[{title,content}], projectName:'t', options:{}, savePath:'D:/code/writer/.superpowers/t.pdf'})` resolve true 且文件存在>1KB；(c) 渲染进程 console 无新增 CSP/安全报错（CDP Runtime/Log 域收集）。证据写报告。
- [ ] Step 4: 关应用；Commit `fix(security): drop dev web-security switches, harden export window`。

### Task 2: ai-types + 主进程 settings + 设置 UI

**Files:**
- Create: `src/common/ai-types.ts`
- Create: `electron/main/ai/settings.ts` + `settings.test.ts`
- Create: `electron/main/ipc/modules/ai.ts`（先只 getSettings/setSettings/testConnection 占位——testConnection 在 T3 前返回 not-implemented 错误）
- Modify: `electron/main/ipc/handlers.ts`、`electron/preload/index.ts`、`src/common/ipc.ts`（通道+门面类型）、`src/renderer/hooks/useIPC.ts`（useAISettings）
- Create: `src/renderer/components/Settings/AiSettingsSection.tsx`；Modify: `src/renderer/pages/Settings/index.tsx`（挂载）
- Modify: `src/renderer/styles/theme.ts` 或组件内 token 化样式（禁 !important 新账）

**Interfaces:**
- `ai-types.ts`（主/渲染共用）：
```ts
export type AiProtocol = 'openai' | 'anthropic'
export type AiFeature = 'organize' | 'completion' | 'review'
export interface AiModels { organize?: string; completion?: string; review?: string }
export interface AiSettings { protocol: AiProtocol; baseUrl: string; apiKey: string; defaultModel: string; models: AiModels }
export interface AiSettingsView { protocol: AiProtocol; baseUrl: string; hasKey: boolean; maskedKey: string; defaultModel: string; models: AiModels } // 掩码视图，永不含明文 key
export interface AiSettingsPatch { protocol?: AiProtocol; baseUrl?: string; apiKey?: string; defaultModel?: string; models?: AiModels } // apiKey 空串/缺省=不改
export interface AiUsageRecord { ts: string; feature: AiFeature; model: string; promptTokens: number; completionTokens: number; cachedTokens?: number }
export interface AiChatRequest { requestId: string; projectPath?: string; feature: AiFeature; model?: string; messages: AiMessage[]; temperature?: number; maxTokens?: number }
export interface AiMessage { role: 'system'|'user'|'assistant'; content: string }
export interface AiChunkEvent { requestId: string; text: string }
export interface AiDoneEvent { requestId: string; usage: { promptTokens: number; completionTokens: number; cachedTokens?: number } }
export interface AiErrorEvent { requestId: string; kind: 'not-configured'|'auth'|'network'|'timeout'|'provider'|'cancelled'|'busy'; message: string }
export function maskKey(key: string): string // '' → ''；≤8 → '••••'；否则 `${key.slice(0,3)}…${key.slice(-4)}`
export function isConfigured(s: AiSettings): boolean // protocol && baseUrl && apiKey 非空
```
- `settings.ts`：`loadSettings(): AiSettings`（userData/ai-settings.json，缺/坏→默认 `{protocol:'openai',baseUrl:'',apiKey:'',defaultModel:'',models:{}}`，坏文件 console.warn 不抛）；`saveSettings(patch: AiSettingsPatch): AiSettingsView`（合并语义：apiKey undefined|'' =保留；写盘失败抛）。测试用 vi.mock('electron') 注入临时 userData。
- 通道：`ai:getSettings(): Promise<AiSettingsView>`、`ai:setSettings(patch): Promise<AiSettingsView>`、`ai:testConnection(): Promise<{ok:true}|never>`（T3 前抛 `{kind:'not-configured',message:'AI 服务尚未就绪'}`——占位诚实）。
- UI：协议 Select（openai/anthropic）、Base URL、Key（Input.Password，占位显示掩码+"已设置"）、默认模型、三个功能模型覆盖（折叠"高级"）、保存、测试连接按钮（结果 message 回显）。全中文、token 化样式。

- [ ] Steps: TDD（maskKey/isConfigured/settings 合并语义/坏文件容错）→ 实现 → UI → 全门 → Commit `feat(ai): shared types, main-process settings vault (masked), settings UI`。

### Task 3: provider 适配器（openai + anthropic）

**Files:**
- Create: `electron/main/ai/providers/types.ts`、`openai.ts`、`anthropic.ts`、`index.ts`（getProvider(settings)）
- Create: `electron/main/ai/providers/providers.test.ts`

**Interfaces:**
- `types.ts`：
```ts
export interface ProviderChatResult { usage: { promptTokens: number; completionTokens: number; cachedTokens?: number }; text: string }
export interface ProviderChatOptions { signal?: AbortSignal; timeoutMs?: number } // 默认 30_000
export interface AiProvider {
  chat(settings: AiSettings, model: string, req: Pick<AiChatRequest,'messages'|'temperature'|'maxTokens'>, onChunk: (t: string) => void, opts?: ProviderChatOptions): Promise<ProviderChatResult>
  testConnection(settings: AiSettings, model?: string): Promise<{ ok: true; sample: string }> // openai: GET {base}/models 取 1 条；anthropic: 最小 1-token messages 调用
}
export class AiCallError extends Error { kind: AiErrorEvent['kind'] } // message 已截断 ≤300 字符且证明不含请求头
export function extractJsonLoose(raw: string): unknown // 剥 ```json 围栏/截取首尾花括号；失败抛 kind:'provider'
```
- openai.ts：POST `{baseUrl}/chat/completions`，headers `Authorization: Bearer`，body `{model,messages,stream:true,temperature?,max_tokens?}`；SSE：按行 `data: `，`[DONE]` 结束，delta.content→onChunk，末个含 usage 的块记账（无 usage 时用 estimate 兜底由调用方做，provider 只报所见）。
- anthropic.ts：POST `{baseUrl}/v1/messages`，headers `x-api-key` + `anthropic-version: 2023-06-01`，body `{model,max_tokens(默认 4096 必填),system 拆出,messages,stream:true}`；事件 `content_block_delta`(text_delta)、`message_delta`(usage.output_tokens)、`message_stop`。
- fetch 注入：模块导出可替换的 `globalFetch` 或构造参数（测试注入假 fetch）。错误分类：401/403→auth；AbortError-timeout→timeout；AbortError-cancel→cancelled；fetch reject→network；其余 !ok→provider（body 摘要截断，**绝不回显请求头**）。
- 测试（假 fetch，无网络）：两协议流式 happy（多 chunk 跨行边界、不完整尾行）、非流式 usage 缺失、401 分类、超时分类、extractJsonLoose 四路（裸 JSON/围栏/前后杂文本/坏输入）、testConnection 两协议。

- [ ] Steps: TDD → 实现 → 全门 → Commit `feat(ai): openai-compatible and anthropic provider adapters with SSE parsing`。

### Task 4: chatService 流式通道 + usage 账本 + useAI + 统计区块

**Files:**
- Create: `electron/main/ai/chatService.ts`、`electron/main/ai/usage.ts` + 各自 test
- Modify: `electron/main/ipc/modules/ai.ts`（接 chat/cancel/getUsage 真实现）、`electron/preload/index.ts`、`src/common/ipc.ts`、`src/renderer/hooks/useIPC.ts`
- Create: `src/renderer/hooks/useAI.ts`
- Modify: `src/renderer/components/Explorer/StatsPanel.tsx`（token 分账区块）

**Interfaces:**
- chatService：`registerAiChat()`：`ai:chat` → isConfigured 校验（不配置回 not-configured）→ getProvider(settings).chat(...)，onChunk→`send('ai:chunk',{requestId,text})`；resolve→`ai:done`+（req.projectPath 存在则）usage append；reject(AiCallError)→`ai:error{kind}`；同 requestId 并发=后到回 busy；`ai:cancel(requestId)`→abort controller，幂等。webContents 用 event.sender，发送前 isDestroyed 检查。
- usage.ts：`appendUsage(projectPath, rec)`→`.ai/usage.jsonl` 追加（mkdir -p，单行 JSON+`\n`，不读旧文件）；`readUsageSummary(projectPath): {byFeature: Record<AiFeature,{calls,prompt,completion,cached}>, total, byModel: Record<string,...>}`（读空/坏行跳过）。
- `useAI()`：`chat(req: Omit<AiChatRequest,'requestId'> & {requestId:string}, h:{onChunk,onDone,onError})`——内部单监听器池按 requestId 分发，返回 unsubscribe；组件卸载必须清理（供 M4b 用）。
- StatsPanel：`ai:getUsage(projectPath)` → "AI 用量：整理 N 次 · 提示 X / 补全 Y tokens" 区块（无数据显示"暂无 AI 用量"）。

- [ ] Steps: TDD（chatService 用注入假 provider：chunk 序列→事件顺序、并发 busy、cancel、账本落盘聚合）→ 实现 → UI 区块 → 全门 → Commit `feat(ai): streaming chat channel with per-request isolation and token ledger`。

### Task 5: 上下文装配器 + token 估算（纯函数）

**Files:**
- Create: `src/common/ai-context.ts` + `ai-context.test.ts`（纯，无 electron，主/渲染共用）

**Interfaces:**
```ts
export function estimateTokens(text: string): number // CJK 每字 1 + 其余每 4 字符 1（向上取整）
export interface ContextBook { meta: BookMeta; volumes: VolumeDoc[]; outlineNotes: string; chapters: { id: string; title: string; volumeId: string | null; order: number }[] }
export interface ContextInputs {
  book: ContextBook
  currentChapterId: string
  chapterBody: string                    // 当前章正文（保底必含）
  chapterSummaries: Record<string, string>   // .ai/summaries/chapters 已有者
  volumeSummaries: Record<string, string>    // 卷梗概已有者
  entityIndex: Record<string, string[]>      // 实体 id → 出场章 id（M4b 维护；可空对象）
  entityCards: { character: CharacterV2[]; world: WorldEntryV2[] } // 候选卡池
  budgetTokens: number
}
export interface AssembledContext { messages: AiMessage[]; droppedFor: string[]; estTokens: number }
export function assembleAiContext(inp: ContextInputs): AssembledContext
```
- 组装优先级（spec §7.4）：system 提示骨架（固定，含"完美小说设定管家"角色说明）> 当前章正文 > 涉事实体卡（entityIndex 命中当前章的 character/world，卡片 JSON 化）> 最近 3 章摘要（order 前驱）> 当前卷梗概 > 全书大纲线（卷列表+synopsis）。
- 裁剪：从**最低优先级**开始整段丢弃直至入预算；正文超预算 80% 时截断保尾（写作续写场景保近文）并 droppedFor 记 `body-truncated`；任何情况不得引入"非当前章整章正文"或非涉事实体卡（红线测试）。
- 测试：fixture 书（3 卷 30 章 20 角色 10 词条 + 部分摘要 + 索引）；断言：满预算含全部层；紧预算按序丢（droppedFor 精确）；极小预算只剩骨架+截断正文；红线（输出不含任何非当前章正文子串）；estimateTokens 钉值（'你好 Hello'→2+2=4？'你好'=2、' Hello'=5 字符→2 → 4；实现按定义算，测试钉实现定义）。

- [ ] Steps: TDD → 实现 → 全门 → Commit `feat(ai): layered context assembler with token estimation`。

### Task 6: 测试连接闭环 + 文档收口

**Files:**
- Modify: `electron/main/ipc/modules/ai.ts`（testConnection 接真 provider）、`src/renderer/components/Settings/AiSettingsSection.tsx`（按钮态/结果文案）
- Modify: `docs/BOOK_FORMAT.md`（.ai/ 区正式化：usage.jsonl/proposals/summaries 预留、隐私姿态）、`README.md`、`docs/DEVELOPMENT.md`（M4a 行）
- Create: `docs/superpowers/plans/2026-10-28-m4a-closeout.md`（简版收尾）

- [ ] Step 1: testConnection 真实现（openai：GET /models Bearer；anthropic：1-token messages）；错误复用 AiCallError 分类；UI 显示"连接成功（模型列表 N 个/延迟 xx ms）"或分类中文错。
- [ ] Step 2: 文档三件（BOOK_FORMAT 的 .ai/ 段从"预留"升为"已启用：usage.jsonl；proposals/summaries 将于 M4b 启用"）。
- [ ] Step 3: 全门 + CDP 冒烟：设置页配置假 baseUrl（http://127.0.0.1:9/ 必然 network 错）→ 测试连接显示"网络错误"分类而非崩溃；无 key 时按钮置灰。
- [ ] Step 4: Commit `feat(ai): connection test wiring, ai docs and m4a closeout`。

---

## M4a 完成定义（DoD）

- 安全硬化落地且 CDP 证明应用完好（T1 证据在案）。
- 双协议 provider 假 fetch 全绿；流式通道 requestId 隔离/取消/busy/账本聚合测试钉死。
- 设置页可配可测（错误分类可读）；key 全程不出主进程（掩码）。
- 装配器预算/优先级/红线测试全绿（spec §7.4 可证）。
- 全门禁绿；文档三处更新；人工冒烟（真 key 连接测试）留发起人。
