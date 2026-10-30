# M5 设计：AI 实时补全（ghost text）

> 状态：brainstorming 产出，待发起人批准（HARD GATE）→ 批准后走 superpowers:writing-plans。
> 上游：`2026-10-25-perfect-novel-repositioning-design.md`（优先级 #2、G4、§7.5、M5 行）与
> `2026-10-28-m4-ai-loop-design.md`（服务层/上下文器/账本即为本功能铺的路）。

## 意图与为什么

小说作者在正文里写下**意图**（「主角使出XX招」「踏入YY场景」）时，希望像写代码一样得到
ghost text：灰字递来那段招式/场景的具体描写，Tab 采纳。与代码补全的本质差异在于描写必须
**有本书的依据**——招式名、场景质感优先取自数据基石里的实体卡（M2/M3 的成果），而非模型
凭空编；同时发起人明确：无卡时也要有想象力地写（优先有卡，非哑火式沉默）。补全难度高于代码
补全且写作是心流活动，故**开关默认关闭**，开启与否是作者对「被打扰预算」的主动选择。

## 目标

- G1 写作编辑器内 ghost text 补全：开关开启时，停笔约 0.9-1s 自动浮现；**逐字流式**灰字；
  Tab 采纳「已到达部分」（天然的部分采纳）；继续打字 / Esc / 失焦 / 切视图即消失。
- G2 依据优先级：当前章引用实体卡（M4c-2 `entityRefs` 并集）加权在前；缺卡退回正文语境自由
  续写（发起人裁定：要有想象力，优先有卡）。
- G3 开关默认关；设置页（AI 设置区）单一开关；开启瞬间一次性提示 toast 说明行为。
- G4 账本：usage.jsonl 记 `feature='completion'`；模型取 `models.completion` 槽，空则回落
  `defaultModel`（M4a 既有解析序）。
- G5 真机冒烟（真 key，CDP）：停笔浮现→Tab 采纳→IME 组字不弹→Esc 取消→账本落 completion 行。

## 非目标（MVP 不做）

- 多候选循环（Alt+[ / ]）；单候选。
- 图谱视图/叙事面板等非写作面的补全。
- 补全结果写回任何数据文件（补全是散文草稿，**不盖 aiSource、不进提案、不落 .ai/**）。
- 补全出处引用/quote 校验（那是提案域的纪律，散文草稿不适用）。
- 离线补全、补全历史、按实体粒度调参。

## 反目标（做成这样就算失败）

- 任何形式的自动采纳（ghost 永远等 Tab）。
- IME 组字期间弹出或采纳（中文输入法合成态屏蔽是硬约束，compositionstart 即撤）。
- 发送全书/全历史正文（上下文预算走 M4a 装配器，见下）。
- 阻塞或延迟键入路径（补全纯异步旁路；主进程崩溃/超时=静默不出，**写作流内绝不 toast 报错**，
  仅 console.warn）。
- 与已采纳设定卡**静默矛盾**不被察觉可接受（自由续写裁定），但装配时卡内容必须在 prompt 里
  具名呈现，让模型有机会对齐。

## 约束

- 复用 M4a 服务层：流式 `[kind]` 协议、双协议 provider、token 账本、上下文装配器
  （`src/common/ai-context.ts`）。**建议**（builder 可改判并说明）：复用 `ai:chat` 通道 +
  feature 标签，不新增 IPC 通道；补全请求带自己的 requestId，撤销复用 M4b cancel 语义
  （dismiss 即 abort，省 token）。
- Monaco 集成机制留给 builder（inlineSuggest provider 或自绘 ghost overlay 均可），硬约束：
  不 fighting IME、dismiss 路径全覆盖、流式更新不重建 editor。
- 零新增运行时依赖；新 UI 全中文；token 化样式；无 !important 新账；纯逻辑必须单测
  （触发状态机/上下文装配/采纳裁剪均为纯函数，可测）。
- 延迟预算：快模型首灰字 ≤2.5s；4s 无首字即 abort 当次（静默）。

## 发起人拍板（对话原话归纳）

1. 场景/招式描写补全，依据来自设定卡；交互照抄写代码手感（ghost+Tab）。
2. 开关默认关闭。
3. 开启后停笔自动浮现（非按键召唤）。
4. 有卡优先、无卡也写（想象力保留）。
5. 流式 vs 一次性：**授权控制器决策** → 控制器拍板流式 + Tab 采纳已到达部分。
6. 修订态（光标后有余文）**不弹**补全：MVP 只服务起草流（章尾/段尾接着写），改稿重写留待未来
   显式召唤键（发起人批准控制器推荐，2026-10-31）。
7. **不加 POV 字段**：上下文给书名+梗概 snippet，人称/视角由模型从光标前正文推断
   （发起人批准控制器推荐，2026-10-31）。

## 控制器拍板（builder 可见，可于计划中反驳并记录）

- 停笔 debounce 900ms；dismiss 后同一前缀 3s 内不重发（防抖闪）。
- 长度上限 ≤3 句 / 约 120 字；遇段落边界即停。
- **触发语义（builder check Q1 基础部分）**：仅「内容变更后的停笔」触发——纯光标移动不触发；
  上下文锚点=光标：取光标前 ~1500 字（非整章尾）；光标后余文（suffix）处理见「待发起人答 1」。
- **装配器分叉（Q2）**：organize 专用装配器（ai-context.ts，37 测试+e2e 钉死确定性、system 骨架
  为「设定管家/绝不臆造」人格）保持不动；补全旁建**同级纯函数装配器**（新文件，复用其预算记账
  纪律与卡序列化助手、entityRefs 并集作为卡源），system 骨架为散文写手人格（呼应「无卡也写」
  裁定）。M4b organize 回归口径不变。
- **角色卡投影（Q4）**：CharacterV2 无单一描述字段——投影取 name+role+appearance+personality+
  background（各截断），WorldEntryV2 取 name+category+content；口吻信息（personality/background）
  在场，呼应上游 §7.5「带人物口吻」。
- 上下文 = 光标前 ~1500 字 + 引用实体卡投影 + 书名一行（「视角」见「待发起人答 2」）；
  预算经新装配器，completion 标签独立记账。
- 专注模式下补全可用（与专注正交）；图谱态不弹。
- 首开开关一次性 toast：「补全已开启：停笔浮现灰字，Tab 采纳，Esc 撤」。
- **结转一行**：MonacoEditor unicodeHighlighting 显式 `includeComments: true`
  （微批 #4 裁定：闭合注释作用域零宽字符盲区；ambiguous/nonBasic 仍 false 故无黄框回归）。

## 留给 builder

Monaco 机制选型与流式更新实现、debounce/重试/同前缀缓存调参、补全 prompt 文本、
provider 错误分类（not-configured/auth/network → 静默 no-suggest）、测试接缝、
CDP 冒烟脚本（流式 ghost 的 DOM 断言方式）。

## 验收草纲（计划阶段细化）

- 单测：触发状态机（pause/typing/IME/dismiss/abort 转移表）、上下文装配（卡优先序+预算）、
  Tab 采纳裁剪（流到一半采纳=截断到已到达文本）。
- 真机 CDP（真 key）：G5 全条；坏配置/断网=静默不出且写作无感；usage.jsonl completion 行
  模型名=completion 槽实发值。
- 门禁沿用：typecheck 0 / lint 0 error / vitest 全绿不回退 / build。
