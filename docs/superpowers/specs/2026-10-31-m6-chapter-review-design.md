# M6 设计：章节审阅（reader-view structured review）

> 状态：brainstorming 产出，待发起人批准（HARD GATE）→ 批准后走 superpowers:writing-plans。
> 上游：`2026-10-25-perfect-novel-repositioning-design.md`（G5、优先级 #3、M6 行）与
> `2026-10-28-m4-ai-loop-design.md`（服务层/提案引擎即为本功能铺的路）。

## 意图与为什么

烂尾病的最后一道防线：写完一章后，AI 以**读者视角**递一份结构化意见单——既对账
（伏笔未回收、设定/动机冲突），也谈感受（节奏拖、配角扁平）。与「整理」（M4b，记演化数据）
和「补全」（M5，递散文）不同，审阅**只出意见不动数据不动散文**；硬意见的价值终点是
**一键转提案**进入既有人确认流水线，软意见的价值终点是被作者读到。

## 目标

- G1 工具栏「审阅」按钮+未处理徽标；手动触发（审阅贵，不做自动/建议式）；范围默认=当前章
  （全书设定卡+伏笔台账+梗概+章序作背景），可选连续多章。
- G2 意见单对话框（沿用提案面板手感）按章分组；两类意见并列一等：硬对账
  （foreshadow-unresolved / setting-conflict / motivation-break）与软感受
  （pacing / flatness / prose-craft）；每条锚定段落（引文片段+段号）。
- G3 点意见→编辑器跳段+高亮；硬意见一键转提案（伏笔未回收→新台账条目提案、设定冲突→
  设定修订提案，走 M4b 提案引擎、带 aiSource 纪律、进差异确认面板）；软意见只读+可驳回。
- G4 意见落 `.ai/reviews/` 纯文件（人可读、书内账，与 proposals/usage 同待遇），状态
  open/dismissed/converted；跨会话存续；重审按章替换 open 意见，dismissed 按
  「chapterId+类+锚」同章持久抑制防复读。
- G5 账本 `feature='review'`；模型走 `models.review` 槽（空回落 defaultModel，M4a 解析序）。
- G6 真机冒烟（真 key）：审一章→意见锚定呈现→跳转高亮→dismiss 持久→硬意见转提案见于
  差异面板→账本 review 行。

## 非目标（MVP 不做）

- 全书大扫查（成本/意见量爆炸；与存量回填同族未来项）。
- 多人格审阅视角、审阅导出（spec 结转）。
- 审阅自动改散文/自动落任何数据（硬纪律）。
- 软意见转提案（散文是作者地盘）。
- 第六侧栏 tab（280px 五 tab 已满；审阅入口=工具栏+徽标+对话框）。
- 写作流内任何审阅 toast/打断。

## 反目标（做成这样就算失败）

- 意见无锚或锚漂移后假装命中（找不到引文必须显式「锚已失」态，不得错位高亮）。
- 重审复读已驳回意见（dismissed 抑制失效=信任破产）。
- 转提案绕过 M4b 人确认流水线（无 aiSource、不进差异面板=纪律破坏）。
- 审阅失败静默无反馈（用户主动发起的操作，错误必须在对话框内可见——区别于补全的静默）。
- 单次审阅 token 失控（范围上限+背景装配预算硬顶，超顶拒绝并提示收窄）。

## 约束

- 复用 M4a 服务层（双协议/流式/账本）与 M4b 提案引擎（转化路径）；**建议**复用 `ai:chat`
  通道+feature 标签（builder 可改判并记录）；不新增书数据 schema 字段（reviews 是书内
  `.ai/` 账，非 BOOK_FORMAT 数据域——BOOK_FORMAT 增一节描述 reviews 目录形态）。
- 零新增运行时依赖；新 UI 全中文；token 化样式；无 !important 新账；纯逻辑必须单测
  （锚重定位/意见 schema 校验/转化映射均为纯函数）。
- 门禁沿用：typecheck 0 / lint 0 error / vitest 全绿不回退（基线 820）/ build。
- 延迟与成本：单章审阅首意见 ≤15s 开始流式呈现（对话框内流式列表）；范围上限=连续 5 章，
  背景装配预算硬顶（builder 定数值，超顶 UI 拒绝）。

## 发起人拍板（对话原话归纳）

1. 硬对账与软感受**两者皆有**，并列一等公民。
2. 范围策略**授权控制器决策**（默认单章/可选连续多章/全书扫查不进 MVP）。
3. 回放全幅确认「没问题」（触发/存续/消费/转化/重审/反目标各条）。
4. 该章已有未消化整理提案时，转化**并入该份提案**（引擎 additive 追加操作，不放宽
   「同章单份未消化」不变量）——「一键」永远可用（发起人批准控制器推荐，2026-10-31）。
5. motivation-break 硬意见转化落**角色卡修订**（goals/flaws/background 更新提案）；意见带涉事
   角色 id，模型未给/给错时转化弹角色选择器兜底（发起人批准控制器推荐，2026-10-31）。

## 控制器拍板（builder 可见，可于计划中反驳并记录）

- 入口=工具栏按钮+徽标+对话框（非侧栏 tab）；对话框内错误可见（主动操作语义）。
- 锚=引文片段（≤40 字）+段号；渲染时引文全文搜索重定位，失败=「锚已失」灰态（可驳回可转化
  但跳转禁用）。
- dismissed 抑制键=「类别+锚引文规范化哈希」；converted 意见保留转化指针（proposalId）。
- 重审=同范围新意见集替换 open；open 中未被重发且未 dismiss 者标 stale 而非删除（作者可见
  「上次意见未重现」）。
- 软意见动作集={驳回}；硬意见动作集={驳回, 转提案}；转化后意见状态 converted+只读。
- 意见 schema：{id, chapterId, category(六类), severity(hard/soft), anchor{quote,paraIndex},
  text, suggestion?, status, createdAt, model, proposalId?, targetEntityId?}——纯文件 YAML/JSON
  由 builder 选（建议 JSON Lines 或单文件 JSON，人可读优先）。`targetEntityId?` 为可选：模型
  确信时输出（背景装配须把设定卡/角色卡 id 呈现给模型）；转化时校验存在+类别匹配，缺失/无效
  →对话框内实体选择器（按类别预滤）兜底，作者手点。**此为对原钉板的明文修订**（builder check Q2）。
- **转化路径与 PROPOSAL_DUPLICATE 闸门共存（builder check Q1，发起人拍板 4）**：该章无未消化
  提案→走既有 `proposal:save` 新建；已有→走**新增 additive 引擎操作**（尾部追加 changes 到该
  未消化提案，既有 index 稳定、追加条目带 aiSource review 出处、仍一文件/章不变量、差异面板
  一次确认两来源）。不放宽闸门、不禁用按钮——「一键」恒可用。BOOK_FORMAT §7 增补追加语义一节。
- **motivation-break 转化目标（builder check Q3，发起人拍板 5）**：映射表=foreshadow-unresolved→
  伏笔台账 create；setting-conflict→world update；motivation-break→character update（target 须
  角色卡，选择器兜底预滤角色）。三类硬意见动作集均={驳回,转提案}，G3 无失信。
- **重审「同范围」语义（builder check Q4）**：按**新范围内逐章替换**——新 run 对其覆盖的每一章
  替换该章 open 意见；不在新范围内的章的旧意见原样存活（不幽灵堆积、不徽标虚高）。stale 为
  **open+`stale:boolean` 标记**（非第四 status 枚举，schema 校验纯函数钉三值不变）。徽标计
  open（含 stale）；stale 渲染灰+「上次未重现」tag；stale/dismissed 不可转化（仅 open 可）。
  重审部分失败：成功章照常替换提交，失败章保留旧意见+对话框内按章报错。
- **多章=逐章 N 次 ai:chat 调用（builder check Q5）**：顺序发起、每章独立 requestId+独立账本
  review 行；对话框按章分节流式呈现，单章 ≤15s 首意见 SLA 对**首章**计；第 k 章失败=该节错误、
  其余章部分成功照常替换/记账；取消=停循环+逐个 cancel 在途；背景装配预算硬顶按**单请求**计、
  范围上限 5 章按 N×单章 在 UI 拒绝超顶。
- **dismissed 抑制键含 chapterId（builder check Q6，对原钉板的修订）**：键=「chapterId+类别+
  锚引文规范化哈希」，**同章生效**。全书生效会吞掉他章真实同类意见（反方向数据丢失），与防
  复读的信任目标对冲；同章即足以防「重审复读已驳回」。单测钉键稳定性+跨章不抑制。
- **「git-ignored 书内账」划掉（builder check Q7）**：描述性散文，非实装要求。代码库对书目录
  从无 gitignore 机制（.ai/proposals、usage.jsonl 均不写 .gitignore）；reviews 与它们同待遇，
  BOOK_FORMAT §7 增 reviews 目录形态节、不加 git 纪律。

## 留给 builder

意见分类词典与 prompt 工程（spec 明文授权）、锚重定位匹配算法（空白/标点归一化尺度）、
reviews 目录文件形态、对话框布局细节、背景装配预算数值、转化映射的提案 change 构造、
测试接缝、CDP 冒烟脚本。

## 验收草纲（计划阶段细化）

- 单测：锚重定位（漂移/归一/缺失三态）、意见 schema 校验（status 三值+stale 布尔）、
  dismissed 抑制键稳定+跨章不抑制、转化映射（三类硬意见→对应提案 change 形状+target 校验+
  选择器兜底路径）、append-to-pending 的 index 稳定与 aiSource 盖章、重审按章替换+部分失败提交。
- 真机 CDP（真 key）：G6 全条；坏配置=对话框内可见错误；范围超顶=UI 拒绝；
  账本 review 行 model=review 槽实发值；pending 存在时转化=并入该提案且差异面板见两来源。
- 门禁+BOOK_FORMAT reviews 目录节对表零漂移。
