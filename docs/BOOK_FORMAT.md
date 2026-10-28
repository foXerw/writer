# 书籍数据目录格式（v2，formatVersion = 2）

> 唯一权威定义在代码：`src/common/schema.ts`（类型 + 校验器）、`electron/main/bookStore/paths.ts`
> （目录布局）、`electron/main/bookStore/chapters.ts|volumes.ts|characters.ts|world.ts|narrative.ts`
> （读写语义）。本文与代码不一致时**以代码为准**，并请反馈修订本文。

## 1. 总览

- 一本书 = 一个普通文件夹。打开时 `detectFormat` 三态判定：
  - **v2**：根目录存在 `book.json` 且 `formatVersion: 2`；
  - **v1**：存在 `.novelwriter.json`（或半迁移遗迹 `.novelwriter.json.migrated` 而 book.json 未落成）——
    经 `project:open` 自动**就地迁移**升级为 v2（迁移前整本备份，见 §6）；
  - **invalid**：两者皆无 → 拒绝打开（`INVALID_PROJECT`）。
- `book.json` 已存在但解析失败或版本不符 → **fail-closed** 抛 `CORRUPT_BOOK`，绝不静默降级成 v1 触发重迁。
- 文件名一律**纯 ASCII**：实体文件 = `<id>.yaml`（章节正文 = `<id>.md`，统计 = `stats.json`），
  `id` 为 UUID；中文只出现在内容字段。文件名（stem）即 id 的唯一权威（见 §8 守则 3）。
- 全部 YAML（`js-yaml`，`lineWidth: 120`；JSON 是 YAML 超集，`book.json` 亦按此读写）；
  章节 Markdown = front-matter（`---` 包围的 `ChapterMeta`）+ 正文（**逐字节原样**，含 CRLF/`---`/emoji 零转义）。

## 2. 目录树（全量）

```
<书目录>/
├── book.json                          # 书元信息 + 项目配置（BookMeta）
├── chapters/
│   └── <uuid>.md                      # 章节 = front-matter（ChapterMeta）+ 正文
├── volumes/
│   └── <uuid>.yaml                    # 卷（VolumeDoc）
├── characters/
│   └── <uuid>.yaml                    # 人物卡（CharacterV2，关系边按 id 引用）
├── world/
│   ├── location/<uuid>.yaml           # 世界观词条（WorldEntryV2）
│   ├── history/<uuid>.yaml            #   子目录 = SettingCategory slug，
│   ├── magic/<uuid>.yaml              #   与内容字段 category 一致
│   ├── culture/<uuid>.yaml
│   └── other/<uuid>.yaml
├── plotlines/
│   └── <uuid>.yaml                    # 剧情线（PlotlineV2；录入 UI = 侧栏「叙事」面板，M4c-2 起）
├── choices/
│   └── <uuid>.yaml                    # 关键选项（ChoiceNodeV2）
├── foreshadow.yaml                    # 伏笔台账（ForeshadowLedger，整本单文件）
├── .novelwriter/
│   └── stats.json                     # 写作统计（运行期数据，非书籍内容域，M1 遗留通道）
├── .novelwriter.json.migrated         # ★只读：v1 迁移完成凭据（旧根配置改名，见 §6）
├── .migration-backup/                 # ★只读：迁移前整本时间戳备份（见 §6）
│   └── <消毒后的 ISO 时间戳>/          #   冒号/斜杠替换为 '-'（Windows 文件名合法化）
└── .ai/                               # AI 产物区（见 §7；按需创建，缺失 = 从未用过 AI，是常态）
    ├── usage.jsonl                    # M4a：token 用量账本（追加式 JSONL，见 §7.1）
    ├── proposals/
    │   └── <id>.yaml                  # M4b：AI 整理提案（ProposalFile；id = `prop-<章id前8>-<ts36>`，见 §7.2）
    ├── summaries/
    │   └── chapters/
    │       └── <uuid>.yaml            # M4b：章节摘要缓存（见 §7.3）
    └── index.json                     # M4b：实体-章节索引（Record<entityId, chapterId[]>，见 §7.4）
```

瞬态文件：原子写使用同级临时文件 `<目标名>.tmp-<uuid>` → `renameSync` 覆盖目标；成功即消失，
watcher 对 `.tmp-` 一律忽略（意外崩溃留下的孤儿 tmp 文件可安全手删）。

## 3. 通用规则

- **实体 `id`**：匹配 `UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
  （例外：`CharacterTag.id` 只要求非空字符串——v1 历史数据有意豁免）。
- **时间戳**：一律 ISO 8601 字符串（`new Date().toISOString()` 形态），根治 v1 Date 序列化漂移。
- **枚举集合**（校验器口径）：
  - `ProjectType`：`novel | script | essay`
  - 章状态：`draft | revising | completed`
  - 角色性别：`male | female | other`；角色定位：`protagonist | antagonist | supporting | minor`
  - 设定分类：`location | history | magic | culture | other`
  - 剧情线状态：`active | done | dormant`；伏笔状态：`open | resolved | abandoned`
- **未知多余字段一律容忍**（向前兼容）；校验器只查必备字段存在 + 类型正确 + 枚举合法 + id 为 UUID，
  引用完整性（targetId/parentId/chapterId 指向是否存在）属仓库层，不在字段校验内。

## 4. 每类文件字段表（逐字对照 `src/common/schema.ts`）

### 4.1 `book.json` — BookMeta

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | 稳定书 id，跨次打开不变（v1 时代每次打开随机生成的行为已废除） |
| `name` | string | ✅ 非空 | 书名 |
| `type` | ProjectType | ✅ | 见 §3 枚举 |
| `formatVersion` | `2` | ✅ | 值不符 2 → `detectFormat` 抛 `CORRUPT_BOOK` |
| `config` | ProjectConfig | ✅ | 对象，四键见下表 |
| `synopsis` | string | ✅ | 可空串 |

ProjectConfig（嵌套对象，无独立文件）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `wordCountGoal` | number（有限） | ✅ | 全书字数目标，0 = 不限 |
| `dailyGoal` | number（有限） | ✅ | 每日目标 |
| `autoSave` | boolean | ✅ | 自动保存开关 |
| `autoSaveInterval` | number（有限） | ✅ | 自动保存间隔（毫秒） |

### 4.2 `chapters/<uuid>.md` — front-matter：ChapterMeta；其后 = 正文

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | 与文件名 stem 一致（stem 是读取侧权威） |
| `title` | string | ✅ 非空单行 | 写侧拒绝空白/含换行（`CHAPTER_TITLE_INVALID`） |
| `volumeId` | string \| null | ✅ | 显式 `null` = 未分卷；不允许缺键/undefined |
| `order` | number | ✅ | 稠密 1..n 语义（移动/重排由应用重编号） |
| `status` | enum | ✅ | `draft \| revising \| completed` |

front-matter 编解码契约（`src/common/chapterDoc.ts`）：

- 序列化恒定产出 `---\n<yaml>\n---\n\n<body>`；正文原样拼接、零转义。
- 解析只认文件**第一行为 `---`**（去掉行尾 `\r` 后比对）、其后第一个 `---` 行为闭合定界；容忍一个前导
  BOM；闭合行后 `\n\n` / `\n` / `\r\n\r\n` / `\r\n` / EOF 收尾同义（只归一化掉紧随的一个换行序列，
  body 其余字节含内部 `\r\n` 一律原样保留）。写出（serialize）恒为 LF、无 BOM。
- 无 front-matter 抛 `FRONTMATTER_MISSING`；块坏/meta 不合法抛 `FRONTMATTER_INVALID`。
  列表侧（`listChapters`）对坏文件 warn+跳过（该章隐身但不瘫痪全书）；点读侧抛穿（坏章绝不被静默改写）。

### 4.3 `volumes/<uuid>.yaml` — VolumeDoc

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | |
| `title` | string | ✅ 非空 | |
| `order` | number | ✅ | 稠密 1..n |

### 4.4 `characters/<uuid>.yaml` — CharacterV2

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | |
| `name` | string | ✅ 非空 | 写侧门镜像章 title 门（`CHARACTER_NAME_INVALID`） |
| `gender` | enum | ✅ | `male \| female \| other` |
| `age` | number（有限） | ✅ | |
| `role` | enum | ✅ | `protagonist \| antagonist \| supporting \| minor` |
| `avatar` | string | ❔ | 可选 |
| `appearance` / `personality` / `background` | string | ✅ | 可空串，但键必须存在 |
| `goals` / `flaws` / `notes` | string | ❔ | 可选 |
| `relationships` | EntityLink[] | ✅ | 关系边按 id；写前引用检查（只拒本次新引入幻影 `REF_BROKEN`） |
| `arc` | CharacterArcStage[] | ✅ | 可空数组；`arc[].chapterIds` 对章 id 同一引用规则 |
| `tags` | CharacterTag[] | ✅ | |
| `links` | EntityLink[] | ✅ | 通用互链（目标集 = 角色 ∪ 卷 ∪ 词条） |
| `aiTouched` | string[] | ❔ | M4b origin 机制：AI 采纳引擎写过的字段名清单（校验器不检查；语义见 §7.5） |
| `aiSource` | `{ proposalId: string; cid: string }` | ❔ | M4c-2 create 幂等令牌：采纳引擎 create 落盘时盖章的出处（两字段均非空字符串；语义见 §7.5，**手写实体请勿伪造**，见 §8） |
| `createdAt` / `updatedAt` | string | ✅ ISO | update 由仓库侧刷新 `updatedAt`，`createdAt` 以存量为准 |

EntityLink（relationships / links 通用）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `targetId` | string | ✅ 非空 | 指向实体 id |
| `kind` | string | ✅ 非空 | 关系标签（v1 迁移时取 v1 `relationship` 标签，缺失回退 `relationship`） |
| `note` | string | ❔ | 可选备注 |

CharacterArcStage：

| 字段 | 类型 | 必填 |
|---|---|---|
| `title` | string | ✅ 非空 |
| `summary` | string | ✅ |
| `chapterIds` | string[] | ✅ |

CharacterTag：`id`（非空字符串，**有意豁免 UUID**）+ `name`（非空）+ `color`（可选）。

### 4.5 `world/<category>/<uuid>.yaml` — WorldEntryV2

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | |
| `title` | string | ✅ 非空 | |
| `category` | enum | ✅ | `location \| history \| magic \| culture \| other`；**必须与所在目录名一致**（列表只认枚举目录；改类 = 应用先写新路径再尽力删旧档） |
| `content` | string | ✅ | 词条正文 |
| `parentId` | string \| null | ✅ | 世界观层级父词条；合法目标只认词条（不查自指/成环——留 M4 整理） |
| `order` | number | ✅ | |
| `tags` | string[] | ✅ | 纯字符串数组（与角色的 CharacterTag[] 不同） |
| `links` | EntityLink[] | ✅ | 目标集 = 角色 ∪ 卷 ∪ 词条 |
| `aiTouched` | string[] | ❔ | M4b origin 机制（同 CharacterV2，语义见 §7.5） |
| `aiSource` | `{ proposalId: string; cid: string }` | ❔ | M4c-2 create 幂等令牌（同 CharacterV2，语义见 §7.5，勿伪造见 §8） |
| `createdAt` / `updatedAt` | string | ✅ ISO | |

### 4.6 `plotlines/<uuid>.yaml` — PlotlineV2

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | |
| `title` | string | ✅ 非空 | |
| `summary` | string | ✅ | |
| `status` | enum | ✅ | `active \| done \| dormant` |
| `stages` | PlotlineStage[] | ✅ | `title` ✅ 非空、`summary` ✅、`chapterIds` string[] ✅、`entityIds` string[] ✅ |
| `aiSource` | `{ proposalId: string; cid: string }` | ❔ | M4c-2 create 幂等令牌（同 CharacterV2，语义见 §7.5，勿伪造见 §8） |
| `createdAt` / `updatedAt` | string | ✅ ISO | |

### 4.7 `choices/<uuid>.yaml` — ChoiceNodeV2

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | |
| `title` | string | ✅ 非空 | |
| `chapterId` | string | ✅ 非空 | 单值章引用；改到幻影才拒（存量悬挂保留） |
| `options` | ChoiceOption[] | ✅ | `{ label: string ✅非空, consequence: string ✅ }` |
| `aiSource` | `{ proposalId: string; cid: string }` | ❔ | M4c-2 create 幂等令牌（同 CharacterV2，语义见 §7.5，勿伪造见 §8） |
| `createdAt` / `updatedAt` | string | ✅ ISO | |

### 4.8 `foreshadow.yaml` — ForeshadowLedger（单文件整本台账）

顶层 `{ entries: ForeshadowEntry[] }`；ForeshadowEntry：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ UUID | |
| `title` | string | ✅ 非空 | |
| `plantedChapterId` | string | ✅ 非空 | 埋设章 |
| `plannedPayoffNote` | string | ✅ | 计划回收说明 |
| `resolvedChapterId` | string \| null | ✅ | 未回收 = null |
| `status` | enum | ✅ | `open \| resolved \| abandoned`（`reopen` 通道支持撤回边） |
| `note` | string | ❔ | 可选 |
| `aiSource` | `{ proposalId: string; cid: string }` | ❔ | M4c-2 create 幂等令牌（同 CharacterV2，语义见 §7.5，勿伪造见 §8） |

### 4.9 `.novelwriter/stats.json` — StatsData

`{ dailyHistory: { 'YYYY-MM-DD': { words: number, minutes: number } } }`。运行期统计（非内容域、
不在 watcher/缓存五域内），损坏不阻塞打开（读取失败按 null 兜底重建）。

## 5. 示例（真实序列化输出，非手写）

### 5.1 章节 `chapters/11111111-2222-4333-8444-555555555555.md`
（`serializeChapterDoc` 实际输出；标题含 `#` 与 emoji 时由 YAML 引号机制保证闭合定界扫描不被歧义命中）

```markdown
---
id: 11111111-2222-4333-8444-555555555555
title: '第一章 黎明（含 # 井号与 emoji 🌅）'
volumeId: 99999999-8888-4777-8666-555555555555
order: 1
status: draft
---

# 第一章 黎明

正文第一段。

第二段。
```

### 5.2 `book.json`

```yaml
id: 99999999-8888-4777-8666-555555555555
name: 星海拾荒者
type: novel
formatVersion: 2
config:
  wordCountGoal: 0
  dailyGoal: 2000
  autoSave: true
  autoSaveInterval: 30000
synopsis: ''
```

### 5.3 `volumes/99999999-8888-4777-8666-555555555555.yaml`

```yaml
id: 99999999-8888-4777-8666-555555555555
title: 第一卷 黎明
order: 1
```

### 5.4 `characters/aaaaaaaa-1111-4111-8111-111111111111.yaml`

```yaml
id: aaaaaaaa-1111-4111-8111-111111111111
name: 阿明
gender: male
age: 24
role: protagonist
appearance: 黑发青衫
personality: 沉稳
background: 海边长大
relationships:
  - targetId: cccccccc-3333-4333-8333-333333333333
    kind: 朋友
    note: 青梅竹马
arc:
  - title: 觉醒
    summary: 从迷茫到坚定
    chapterIds:
      - 11111111-2222-4333-8444-555555555555
tags:
  - id: tag-1
    name: 主角团
    color: '#ff0000'
links: []
createdAt: '2026-10-26T00:00:00.000Z'
updatedAt: '2026-10-26T00:00:00.000Z'
```

### 5.5 `world/location/dddddddd-4444-4444-8444-444444444444.yaml`

```yaml
id: dddddddd-4444-4444-8444-444444444444
title: 青云山
category: location
content: 一座终年云雾缭绕的山。
parentId: null
order: 1
tags:
  - 地理
  - 东方
links:
  - targetId: aaaaaaaa-1111-4111-8111-111111111111
    kind: 出生于
createdAt: '2026-10-26T00:00:00.000Z'
updatedAt: '2026-10-26T00:00:00.000Z'
```

## 6. 迁移遗迹：只读约定

### `.novelwriter.json.migrated`
v1 根配置 `.novelwriter.json` 在**迁移成功收尾时改名**而来（`migrateBook` 的最后一步），即「迁移完成
凭据」。应用不再读写其内容。第三方约定：

- **不要删除、不要改内容、不要改回原名**。
- `book.json` 在时它只是历史凭据；`book.json` 缺失时 `detectFormat` 会把它当作「半迁移待（重）迁
  的 v1」入口（`migrateBook` 备份后补完）——这是有意的救援语义，不是损坏。

### `.migration-backup/`
每次**首次**迁移在任何改写之前对整本书的逐顶层条目复制（不含既有 `.migration-backup`，绝不套娃），
目录名 = 消毒后的 ISO 时间戳（`:` `/` → `-`）。恢复 v1 原件请**从里取出文件**，切勿把整个目录搬回
书顶。应用侧契约：只创建、只读，永不清理、永不改写；中断续传（resume）复用其中最新一份作为原始
状态源，不产生第二份。watcher 对 `.migration-backup/` 下的一切事件忽略。

### 崩溃中断态（唯一无歧义判定）
`book.json` 存在 **且** `.novelwriter.json` 未改名 = 迁移最后一步前崩溃的残留。下次 `project:open`
自动**续传补完**（R1 接线）：已转换的文件不重做、书 id 保持稳定、同 id 角色 json 绝不覆盖已存在的
yaml（跳过 + warning，R2 守卫）、报告照常并入迁移 UI。

## 7. `.ai/`（AI 产物区：M4a 用量账本 + M4b 提案/摘要/索引）

`.ai/` 是**AI 产物命名空间**，全部按需创建（从未用过 AI 的书没有此目录，是常态）。
与正式内容域（chapters/characters/world/…）的分界：`.ai/` 下除 `proposals/` 外全是
**派生数据**——删了可由应用再生，watcher 对整个 `.ai/` 不做域失效（`domainOf` → null）。
M4b 起「提案即文件」：`proposals/` 是应用与第三方 AI 的**交换区**（可读写，纪律见 §7.2）。

### 7.1 `usage.jsonl` 行格式

JSONL：每行一个 `JSON.stringify(AiUsageRecord)`（UTF-8，追加写 `appendFileSync`，绝不回读改写、
无读-改-写竞态）。字段表（对照 `src/common/ai-types.ts`）：

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| `ts` | string | 是 | ISO 8601 时间戳（调用完成时刻） |
| `feature` | `'organize' \| 'completion' \| 'review'` | 是 | 触发功能（白名单外的行读取侧整行跳过） |
| `model` | string | 是 | 实际使用的模型名（非空） |
| `promptTokens` | number | 是 | 输入 token 计数 |
| `completionTokens` | number | 是 | 输出 token 计数 |
| `cachedTokens` | number | 否 | 缓存命中输入 token（协议不回报时缺省） |

**隐私姿态**：每行只含计数/模型名/功能名/时间戳——**永不含**提示词正文、生成内容与任何密钥。
聚合读取（`ai:getUsage`）只回计数摘要。读侧容错：缺文件=全零摘要（从未用过 AI 是常态）、
坏行/类型漂移行静默跳过——账本是展示性统计，永不炸统计面板。写失败只 warn 不抛（记账失败
绝不吞掉对话结果）。**可安全手删/整目录删除**：丢失的只是历史用量，书籍内容域零影响。

### 7.2 `proposals/<id>.yaml` — AI 整理提案（ProposalFile）

「整理本章」的产物 = 一份待作者审阅的结构化变更提案（diff 确认流的落盘区；权威定义
`src/common/proposal.ts`，读写语义 `electron/main/bookStore/proposals.ts`）。文件名 stem 即
提案 id（权威），id 形状 `prop-<章id前8位>-<ts的36进制>`（**非 UUID**；应用侧对含路径分隔符/
控制字符的 id 一律 `BAD_PROPOSAL_ID` 拒绝）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ 非空 | 与文件名 stem 一致（读取侧以 stem 为准） |
| `chapterId` | string | ✅ UUID | 出处章（整理触发章）；`proposal:save` 盖章：非现存章拒落 |
| `createdAt` | string | ✅ ISO | |
| `aiModel` | string | ✅ 非空 | 产出模型名 |
| `status` | enum | ✅ | `pending \| partial \| settled`（迁移由应用管理，见下） |
| `changes` | ProposalChange[] | ✅ 非空 | 变更条目（形状见下） |
| `appliedIndexes` | number[] | ❔ | 已采纳条目索引；**唯一写入口 = 应用的 markSettled 记账**（缺失 = 尚无采纳）。M4c-1 起 = `appliedCids` 对当前 changes 的**位置投影**（同一原子写双写，语义恒等，供旧读者） |
| `appliedCids` | string[] | ❔ | 已采纳条目**键**记账（M4c-1，权威）：键 = `changeKey(change, index)`（`cid`，无 cid 条目回退 `idx:<index>` 位置键）。**唯一写入口 = markSettled 双写**（reject 同步收缩重算）。一旦存在即为「已采纳」判定的唯一权威；缺失 = 纯 legacy 文件（位置语义） |

ProposalChange：`cid`（❔ 稳定变更标识，M4c-1——见下「记账键域」）、`op`（create/update/delete）×
`entity`（character/world/plotline/choice/foreshadow/summary/index）组合表钉死在 `ALLOWED_OPS`——
**delete 仅限 plotline/choice/foreshadow**（AI 无权删角色/设定，分工铁律）；`targetId`
（update/delete 必填）、`before`（展示用快照，可选）、`after`（create/update 必填，内容深校验发生在
**采纳期**）、`source` `{chapterId: UUID, quote: 非空 ≤300 字}`（出处引文，必须逐字来自正文）、
`overwritesHuman`（仅 update 有意义，见 §7.5）。

示例 `.ai/proposals/prop-11111111-mvrlcc00.yaml`（pending 提案两条变更：新建角色 + 覆盖人写字段；
`before` 仅为面板展示快照、可缺省；`createdAt` 为 `new Date().toISOString()` 形态；`cid` 为整理链
盖章的 UUID——应用产出的提案每条恒有，手写文件可缺省）：

```yaml
id: prop-11111111-mvrlcc00
chapterId: 11111111-2222-4333-8444-555555555555
createdAt: '2026-10-28T09:12:03.417Z'
aiModel: claude-sonnet-4-5
status: pending
changes:
  - cid: 7c9e6679-7425-40de-944b-e07fc1f90ae7
    op: create
    entity: character
    after:
      name: 拾荒老周
      role: supporting
      gender: male
      age: 57
    source:
      chapterId: 11111111-2222-4333-8444-555555555555
      quote: 老周把最后一块能源核心塞进阿明的背包，没说话。
  - cid: 550e8400-e29b-41d4-a716-446655440000
    op: update
    entity: character
    targetId: aaaaaaaa-1111-4111-8111-111111111111
    overwritesHuman: true
    before:
      goals: 攒够钱离开这颗星
    after:
      goals: 找到回家的航线
    source:
      chapterId: 11111111-2222-4333-8444-555555555555
      quote: 阿明说，等攒够钱，他要找到回家的航线。
```

- **记账键域（M4c-1 稳定 change-id）**：`cid` 是每条变更的记账主键（应用整理链产出时盖章 UUID；
  校验：出现即非空字符串、**同文件内唯一**——重复 cid = `PROPOSAL_INVALID` 文件级错误）。
  键计算全应用单源 `changeKey(change, index) = cid ?? 'idx:<index>'`（无 cid 条目回退位置键，
  与旧位置世界语义一致）。采纳记账**双写**：`appliedCids`（键域，权威）+ `appliedIndexes`
  （位置投影，旧读者兼容），二者在**同一原子写**里更新、语义恒等；`appliedCids` 一经落盘，
  应用即永久转键域权威（该字段存在时 `appliedIndexes` 不再参与判定）。从未双写过的纯 legacy
  文件保持位置语义，照常可读、可采纳、可驳回。reject 删条目后应用对幸存条目重算两账（cid 键
  天然稳定；位置回退键按新位置重算）。**第三方写入建议**：手写新提案请为每条带唯一 cid（推荐
  UUID，避免 `idx:` 前缀——保留给位置回退键，混用会造成键域歧义）；自行维护记账时只写
  `appliedIndexes` 也被接受（应用按位置语义翻译进键域，首次采纳起转双写）。

- **谁写**：① 整理链（T4）经 `proposal:save` 通道落盘（主进程 validateProposal 双保险 + 出处章盖章
  + 条目数上限 200（`PROPOSAL_TOO_LARGE`，通道级政策——存量超限文件仍可读可采纳）），每条变更
  盖章新鲜 `cid`；② 采纳引擎（`bookStore/adopt.ts`）记账重写（appliedCids+appliedIndexes 双写/
  status、驳回按键删条目并同步收缩两账——全部条目删空 = 整份文件删除）；③ **第三方 AI 工具可
  直接读写本目录**（提案即文件的本意）——写前必须过 `validateProposal`（返回空数组才许落盘）+
  原子写（§8 守则 1），文件名 = id；无 cid/只写 appliedIndexes 的旧口径文件仍被接受（见上「记账键域」）。
- **同章去重闸门**（T6 P2，通道级政策）：`proposal:save` 落盘前扫 `listProposals`——该章已有
  **未消化**提案（status 为 `pending`/`partial`）→ 抛 `PROPOSAL_DUPLICATE: <chapterId>` 拒落第二份。
  UI 侧「该章已有未消化提案则禁用整理按钮」只是防呆，这里是引擎侧唯一权威（双窗口各自在途也只会落一份）；
  `settled` 存量不拦——消化完毕的章当然可以再整理出新提案。第三方直写本目录不受此闸门约束
  （交换区本意），但请自律保持同章单份未消化的不变量。
- **谁读**：审阅面板（`proposal:getAll/get`）；坏文件列表侧 warn+跳过（面板永不崩），点读抛穿
  `PROPOSAL_INVALID`。采纳期对每条 change 重跑 `validateChange`（双保险——手改坏的条目按条拒绝，
  好条目照救）。
- **status 迁移**（唯一口径）：已采纳记账（`appliedCids`，纯 legacy 文件为 `appliedIndexes`）
  覆盖全部条目 → `settled`；部分 → `partial`；无 → `pending`。绝不允许手工改 status 而不同步
  记账字段（应用重写时一律以记账重算）。

### 7.3 `summaries/chapters/<uuid>.yaml` — 章节摘要缓存

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chapterId` | string | ✅ | 与文件名 stem 一致（写侧恒注入；读侧键权威见下） |
| `text` | string | ✅ 非空 | 摘要正文 |
| `updatedAt` | string | ✅ ISO | 写入时刻 |
| `aiModel` | string | ✅ | 产出该摘要的提案的模型名 |

**谁写**：仅采纳引擎（summary 条目的 adopt；出处章必须现存）。**谁读**：整理链上下文装配
（T4 `book:readAiData`）。**读侧键权威**（裁定 4 + T6 复核）：摘要映射以**文件内 `chapterId` 字段**
为键（卷摘要目录同，键 = `volumeId`——卷摘要写侧 M4c 才投产，读侧已按同布局宽容消费）；
字段缺失/非字符串时兜底取文件名 stem——写侧布局下两者常态一致，手改分叉时以内容为准。
`text` 非字符串/缺失、整档 YAML 坏 → warn（绝对路径）+ 跳过该条，绝不瘫痪整次读取。
派生缓存——可安全手删（该章摘要缺席直至下次整理重建）。

### 7.4 `index.json` — 实体-章节索引（单文件）

`Record<entityId, chapterId[]>`：entityId ∈ 角色 ∪ 世界观词条 ∪ 伏笔条目；chapterId 数组去重、
按章序（`listChapters` 的 order 升序）存储；历史残留的已删章 id 排尾部（按 id 稳定）。
**真 JSON 字节**（`JSON.stringify` 2 空格缩进——`.json` 后缀名副其实，第三方 `JSON.parse` 直接可读）。

**谁写**：仅采纳引擎（index update 条目的 merge 写；`adds[]` 的 entityId/chapterId 双 UUID +
存在性硬门）。**谁读**：T4 `book:readAiData`、M4c 跳章节。派生结构——损坏时应用 warn 并按空索引
重建；可安全手删（索引由后续整理补建）。

### 7.5 origin 语义：`aiTouched` 与人写内容保护（M4b 铁律）

`CharacterV2` / `WorldEntryV2` 携可选字段 `aiTouched?: string[]`（校验器刻意不检查——宽容）：
AI 采纳引擎写过的字段名清单，**只由采纳引擎维护**（应用字段成功时追加；人手编辑路径原样回显）。

> **某存量字段是「人写」当且仅当：它非空（string trim 后非空 / 数组非空 / number ≠ 0 /
> boolean true）且字段名不在该实体的 `aiTouched` 里。**

采纳引擎对 update 条目的行为：命中人写字段且 `overwritesHuman !== true` → 整条拒绝
（`REFUSED: 覆盖人写内容 <field>`）；`overwritesHuman: true` 还要求该条目索引出现在通道参数
`confirmedOverwrite[]`（差异面板显式勾选）否则 `REFUSED: 未确认覆盖`；`after` 携带 allowlist 与
保留回显集（id/createdAt/updatedAt/aiTouched/status/aiSource）之外的**未知字段** → 整条拒绝
（`REFUSED: 未知字段 <key>`——静默丢弃会让采纳账目说谎）。create×character/world 的新实体
**播种 `aiTouched` = 所写非空字段名清单**（裁定 A：AI 产字段不得伪装人写——后续整理改自己建的卡
无需旗标；空值字段不入账，人后续填写天然是人写）。create×plotline/choice/foreshadow 无此字段。

**`aiSource` create 幂等令牌（M4c-2，五实体通用）**：`CharacterV2` / `WorldEntryV2` / `PlotlineV2` /
`ChoiceNodeV2` / `ForeshadowEntry` 携可选字段 `aiSource?: { proposalId: string; cid: string }`
（出现即要求两个非空字符串——坏形状 = 文档级校验错误，四个列表域 characters/world/plotlines/choices
列表侧 warn+跳过；伏笔台账例外——`foreshadow.yaml` 是单文件台账，读侧 `readLedger` 遇坏条目抛
`FORESHADOW_INVALID`：图谱侧静默降级（console.warn）、整理在 AI 调用前 fail-loud 中文报错、叙事面板
显错，两副面孔系刻意设计，见 M4c-2 收尾裁定 8）。**只由采纳引擎写入**：
create×五实体落盘时盖章 `aiSource = { proposalId: 提案 id, cid: 该条目的记账键 }`（changeKey 单源：
`change.cid`，legacy 无 cid 条目 = 位置回退键）。创建前引擎按令牌全等扫描目标域既有实体：
**命中 = 该条目已应用过 → 视为已应用（计入 applied、不新建、绝不双胞胎）**。这关闭了 M4b 终审/
M4c-1 钉死的最后残留窗口：上次采纳实体已落盘、`markSettled` 记账写失败抛穿 → `appliedCids` 账目
丢失 → 重试放行到 create → 旧世界造出双胞胎；现在重试命中原实体的令牌而跳过，并当场把账补上。
update/delete 路径**不注入也不查询**令牌（其幂等来自既有的值等/缺席语义；update 载荷里回显或
伪造的 `aiSource` 按保留键静默丢弃，存量令牌经基座拷贝原样保留）。已知取舍：legacy 无 cid 提案
的位置回退键身份随 reject 重排漂移——重排后复用的位置键可能命中重排前盖章的陈旧令牌（应用
盖章的提案恒有 cid，无此窗口；第三方手写提案请带 cid，见 §8）。

**差异面板交互（T5）**：`op=update` 且 `overwritesHuman: true` 的条目在审阅面板带橙色警示行
（列出将被覆盖的 after 字段），复选框**默认不勾**——只有作者手动勾选该条，其索引才进入通道参数
`confirmedOverwrite[]`；不勾 = 条目根本不上报（保持 pending，不产生拒绝记录）。勾选集与
`confirmedOverwrite` 的映射不变式：`confirmed ⊆ sent`（confirmed 由勾选集过滤覆盖条目得出），
不存在「勾了覆盖条却没进 confirmed」的失配路径。

已知边界：人手编辑 UI 不改写 `aiTouched`（人改过的 AI 字段仍视为 AI 领地）——UI 侧收口留后续里程碑。

### 7.6 AI 设置与密钥的存放位置（不在书目录）

协议/Base URL/API Key 存于 **Electron `userData`/`ai-settings.json`**（机器级配置，随应用不随书）：

- 明文 `apiKey` **只在主进程**读写，跨 IPC 进入渲染层的永远是掩码视图（`前3…后4`，≤8 全遮）；
- UI 密钥框永不回填明文，留空保存 = 不修改；清除走显式 `clearApiKey` 路径（落盘空串）；
- 该文件不出现在书目录里——拷贝/同步/提交一本书不会带走任何密钥；
- 坏文件回退默认值并 warn（warn 只含错误名/errno，绝不回显文件内容）。

## 8. 第三方 / AI 工具安全操作守则

不通过应用 IPC 而直接读写书目录时（例如 AI 助手、脚本、同步盘），必须遵守：

1. **原子写**：先写同级临时文件 `<目标名>.tmp-<随机>`，再 `rename` 覆盖目标（应用同款）。禁止
   truncate-原地写——崩溃时留下半文件，章节列表侧会把它整章跳过（隐身）。
2. **写前 validate**：组装对象后跑 `src/common/schema.ts` 对应校验器
   （`validateBookMeta` / `validateVolumeDoc` / `validateChapterMeta` / `validateCharacterV2` /
   `validateWorldEntryV2` / `validatePlotlineV2` / `validateChoiceNodeV2` /
   `validateForeshadowLedger`），**返回空数组才许落盘**；错误串自带字段路径。
   章节文件整体 = `serializeChapterDoc(meta, body)` 的字节（正文不可被 YAML 化）。
3. **不改文件名**：文件名 stem 即 id 的唯一权威（读取侧以 stem 为准；应用 update/rename 一律写回
   原路径）。改名 = 实体 id 漂移或对他方不可见；重命名/大小写操作在 Windows 上还有二次坑。
   中文只进内容字段。
4. **新实体 id = 文件名**：新建时生成一个 UUID，同时写入文件名与内容 `id` 字段（章节还写入
   front-matter `id`），三处一致。
5. **order 稠密语义**：章/卷 `order` 由应用维护为稠密 1..n（重排全量重编号、新建取 max+1）。
   外部插入请「先读全表取 max+1」；跳号可容忍但重复 order 会被 `validateMigration` 报告。
6. **deleteVolume 疏散约定**：应用删卷前先把卷内每章 `volumeId` 改写为 `null`（meta-only 写、
   正文逐字节不动）再删 `volumes/<id>.yaml`。外部工具若直接删卷文件，存活章的 `volumeId` 变成
   悬挂幻影（UI 降级显示、不自动清空）——请模仿先疏散后删除。删角色/词条同样不做级联清理：
   指向已删实体的边被有意保留（M4 整理），不要顺手「帮忙清理」制造新悬挂。
7. **引用按 id 且只引已存在目标**：`EntityLink.targetId`、`arc[].chapterIds`、`parentId`、
   `chapterId`（选项节点）、`plantedChapterId`/`resolvedChapterId`（伏笔）。应用写侧只拒
   「本次新引入」的幻影（`REF_BROKEN`）；外部写没有这层闸门，务必自检。
8. **时间戳一律 ISO 字符串**（勿写 Date 对象序列化残格式、勿写 unix 秒数）。
9. **book.json 是 YAML 超集 JSON**：按 JSON 或 YAML 写均可，但键须齐（§4.1）；`formatVersion`
   恒为数字 `2`。watcher 把 `book.json` 归为非实体域（改动不触发 `book:changed`/缓存失效），
   建议**应用关闭时**再改它。
10. **实体文件外部改动是安全的**：watcher 300ms debounce 后广播 `book:changed` 并失效对应域缓存，
    应用自动重拉；若与用户未保存编辑冲突会弹「保留我的 / 重新加载」。但请避免与编辑会话高频抢写。
11. **绝不写入/清理**：`.migration-backup/`、`.novelwriter.json*`（两态都只读）、以及不属于
    §2 树内布局的散落路径（应用忽略但会进 `validateMigration` 视野）。`.ai/` 分区对待（§7）：
    `proposals/` **可读写**（第三方 AI 交换区——写前 validateProposal + 原子写 + 文件名即 id）；
    `usage.jsonl` 只许应用追加；`summaries/`、`index.json` 是应用管理的派生数据——可整删
    （应用会再生），请勿改写半份。
12. **写完自检**：`validateMigration(bookPath)` 是迁移/改写后的体检入口——逐文件校验 + front-matter
    可读性 + order 重复 + v1 残留扫描，永不抛穿（问题以字符串数组返回，空数组 = 健康）。
13. **换行与 BOM**：应用**容忍 CRLF/BOM 读取**（剥一个前导 BOM、定界行去行尾 `\r` 再识别，外部工具整本
    改写 CRLF 不会让章节隐身），但**写出一律 LF**（无 BOM）——第三方文件请以 `serializeChapterDoc` 的
    字节为准；正文内部换行（含 `\r\n`）应用读侧逐字节保留，请勿依赖应用帮你归一化。
14. **勿伪造 `aiSource`、勿事后增删改 `cid`**：`aiSource`（§7.5）是采纳引擎在 AI create 落盘时盖章的
    出处令牌——**手写/新建实体请勿携带该字段**；伪造的令牌与某提案 {id, 条目键} 全等时，会让 AI
    采纳（含重试）误判「已应用」而**跳过创建**——实体静默少一张，且提案账目显示已采纳。提案文件里
    **勿对既有条目事后增删改 `cid`**（记账主键——漂移会让采纳账目/面板灰化全部错位；确需重组条目
    时，同步迁移 `appliedCids`/`appliedIndexes` 记账）。手写提案建议每条自带全文件唯一的 `cid`：
    无 cid 的条目回退位置记账，reject 重排后位置身份漂移（包括陈旧 `aiSource` 令牌误命中复用位置，
    见 §7.5 已知取舍）。

## 9. v1 → v2 迁移语义速览（`electron/main/bookStore/migrate.ts`）

1. 先整本时间戳备份（失败 → 抛错且书目录零字节改动）；
2. `.novelwriter.json` → `book.json`（v1 `settings.*` → `config.*`，缺失键回填默认；续迁不重写、
   书 id 稳定）；
3. `chapters/NNN-标题.md` → `chapters/<uuid>.md`（title 取首个顶格 `# ` 行，次选文件名去编号；
   order 取编号，无编号取 max+n；正文逐字节原样，含 CRLF）；
4. `characters/<id>.json` → `characters/<id>.yaml`（关系边救援序：v1 `characterId` 直解 → 唯一同名
   → 丢弃 + warning；同 id 已存在 yaml 时跳过不覆盖，R2）；
5. `settings/<类别>/…json` → `world/<类别>/<全量id>.yaml`（非 UUID 历史 id 重建 + parentId
   old→new 重映射；悬挂 parentId 置空 + warning；空目录剪除）；
6. 空 `foreshadow.yaml` 台账（已存在不覆盖）；标记改名 `.migrated`（幂等关键）；
7. 返回 `{ backupPath, warnings }` 并入 `ProjectData.migration`，由迁移 UI（toast + warnings 弹窗）
   呈现给作者。

## 10. 版本与兼容策略

- 格式升级 = `FORMAT_VERSION` 递增 + 迁移器扩展；旧版应用打开新版书的行为**未定义**（请勿混用）。
- 未来版本改动本文任何契约（命名、目录、字段、只读约定）必须同步改 `schema.ts` 校验器 + 本文 +
  `e2e.test.ts` 钉死测试。
