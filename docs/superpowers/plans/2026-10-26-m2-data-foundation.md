# M2：数据基石 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「完美小说」v2 纯文件数据目录（实体-关系-事件全套 schema 一次设计到位）、主进程数据访问层（单一入口+缓存失效+文件监听）、v1 项目就地迁移（带备份）、卷一等公民与关系按 id 引用，并把章节/人物卡/设定三块 UI 升到 v2 数据模型。

**Architecture:** 每本书一个自解释目录（book.json + chapters/*.md front-matter + YAML 实体文件），主进程 `electron/main/bookStore/` 是唯一磁盘读写入口（repository 按域分文件，原子写 tmp+rename，fs.watch 驱动缓存失效与 `book:changed` 事件）；渲染进程仍只经类型化门面 `window.novelWriter` 访问。v1→v2 迁移在 project:open 时一次性就地执行，先整体备份到 `.migration-backup/<ISO时间戳>/`。

**Tech Stack:** 既有栈 + **js-yaml**（唯一新增运行时依赖，YAML 读写与 front-matter 解析）；vitest 测纯逻辑（schema 校验器、front-matter 解析、迁移器、repository 用 tmpdir 实测）。

**Spec:** `docs/superpowers/specs/2026-10-25-perfect-novel-repositioning-design.md`（本计划实现 §7.1/7.2 的数据层部分 + §8 M2 行；图谱视图是 M3、AI 闭环是 M4，不在本计划；剧情线/选项/伏笔本计划交付**数据层+门面+校验器，无录入 UI**——M1 已拍板"schema 全做、UI 分步点亮"，录入 UI 随 M4 数据形态定型后补）。

## Global Constraints

- 磁盘格式版本号 `formatVersion: 2`（book.json 字段，数值 2）。
- 所有实体 id = `crypto.randomUUID()` 输出；**文件名一律纯 ASCII**（`<id>.yaml` / `<id>.md`），中文只存在于文件内容与标题字段。
- 书目录的一切读写必须经 `electron/main/bookStore/`（ipc modules 里不得再有直接 fs 手术碰书数据；`project:create` 建骨架除外，它也调 bookStore）。
- YAML 读写只用 js-yaml v4 的 `yaml.load`（v4 默认即安全加载器）/ `yaml.dump(obj, {noRefs:true, lineWidth:120})`；书文件落盘一律原子写（同级 `.tmp-<rand>` 写完 `renameSync` 覆盖）。
- 备份目录 `.migration-backup/` 一旦存在永不覆盖（时间戳新目录）；迁移幂等：v2 项目重复打开不得再次迁移。
- UI 文案中文；App 显示名"完美小说"；英文标识 perfect-novel。
- 门禁（每任务）：`npm run typecheck` 0、`npm run lint` 0 error（1 条既有 warning 容忍）、`npm run test` 全过、`npm run build` ok。
- 每任务一提交，conventional 前缀，末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 既有 IPC 通道名与请求形状尽量向后兼容（新增 `volumeId?` 等可选字段优先于破坏性改形）。

## Review Focus

（规格隐含、任务测试难穷举、最容易咬到真实用户的输入——每条钉到对应任务的测试/冒烟项）

1. **迁移过的 v1 书被反复打开**：第二次起不得再迁移、不得产生第二份备份、章节顺序/标题/字数与迁移前一致（Task 3 测试 + 人工冒烟）。
2. **外部工具直接改书目录 YAML/MD**（发起人的 Claude Code 工作流）：应用要感知并刷新展示；若该文件在应用里有未保存编辑，必须弹警告让用户二选一，绝不静默覆盖（Task 9 冒烟+静态走查）。
3. **同名/重名角色迁移**：v1 关系按名字字符串存储，重名可致歧义——迁移必须"唯一同名才连边，歧义丢弃并记 warning"，UI 不得因悬挂 targetId 崩溃（Task 3/6 测试）。
4. **中文/特殊字符标题**：改名不再动文件名（只改 front-matter），标题含 `#`、`/`、emoji 都不能破坏解析或路径（Task 3 chapterDoc 测试钉值；Task 4 仓库消费）。
5. **卷删除与未分卷**：删卷后其章节 volumeId 置 null 且 UI 归入"未分卷"分组，导出与统计顺序不受影响（Task 5 测试）。

---

### Task 1: schema 类型与校验器（src/common/schema.ts）

**Files:**
- Create: `src/common/schema.ts`
- Create: `src/common/schema.test.ts`
- Modify: `package.json`（`npm i js-yaml @types/js-yaml` —— js-yaml 进 dependencies，@types 进 devDependencies）
- Modify: `src/common/ipc.ts`（`Chapter` 增 `volumeId?: string | null`；`ProjectData` 增 `migration?: MigrationReport | null`；新增导出类型 `MigrationReport { backupPath: string; warnings: string[] }`）

**Interfaces:**
- Produces（全部导出自 `src/common/schema.ts`，主/渲染共用）:
  - 常量 `FORMAT_VERSION = 2`
  - `BookMeta { id: string; name: string; type: ProjectType; formatVersion: 2; config: ProjectConfig; synopsis: string }`
  - `VolumeDoc { id: string; title: string; order: number }`
  - `ChapterMeta { id: string; title: string; volumeId: string | null; order: number; status: 'draft'|'revising'|'completed' }`（+ `ChapterDoc { meta: ChapterMeta; body: string }` 的解析/序列化在 Task 4 的 chapterDoc.ts，本任务只定类型）
  - `EntityLink { targetId: string; kind: string; note?: string }`（关系边/设定链接通用）
  - `CharacterV2 { id; name; gender; age; role; avatar?; appearance; personality; background; goals?; flaws?; relationships: EntityLink[]; arc: { title: string; summary: string; chapterIds: string[] }[]; tags: CharacterTag[]; notes?; links: EntityLink[]; createdAt: string; updatedAt: string }`（createdAt/updatedAt 一律 ISO 字符串，根治 Date 序列化漂移）
  - `WorldEntryV2 { id; title; category: SettingCategory; content; parentId: string | null; order; tags: string[]; links: EntityLink[]; createdAt: string; updatedAt: string }`
  - `PlotlineV2 { id; title; summary; status: 'active'|'done'|'dormant'; stages: { title; summary; chapterIds: string[]; entityIds: string[] }[]; createdAt; updatedAt }`
  - `ChoiceNodeV2 { id; title; chapterId; options: { label: string; consequence: string }[]; createdAt; updatedAt }`
  - `ForeshadowEntry { id; title; plantedChapterId: string; plannedPayoffNote: string; resolvedChapterId: string | null; status: 'open'|'resolved'|'abandoned'; note?: string }`
  - `ForeshadowLedger { entries: ForeshadowEntry[] }`
  - 每类型一个 `validateX(v: unknown): string[]`（返回错误信息数组，空=合法）。校验=必备字段存在+类型对+枚举值在集合内+`id` 匹配 UUID 正则；**不校验引用完整性**（targetId 存在与否属 repository 层，Task 3/6）。
- Consumes: `src/common/ipc.ts` 既有 `ProjectType/ProjectConfig/SettingCategory/CharacterGender/CharacterRole/CharacterTag`。

- [ ] Step 1: 写失败测试 `schema.test.ts`：`validateCharacterV2` 接受最小合法对象返回 `[]`；拒绝缺 `name`（含 "name" 字样错误）与 `role: 'god'`（含 "role"）；`validateForeshadowLedger({entries:[]})` 返回 `[]`；`validatePlotlineV2` 拒绝 stage 缺 `title`。
- [ ] Step 2: `npm run test` 确认 FAIL（模块不存在）。
- [ ] Step 3: 实现 schema.ts：类型逐字按上表；校验器实现为手写守卫函数（无新依赖），UUID 正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`。
- [ ] Step 4: 测试 PASS；ipc.ts 增量改动（`volumeId?`、`migration?`、`MigrationReport`）typecheck 0。
- [ ] Step 5: Commit `feat(schema): v2 entity-relationship-event type set with validators`。

### Task 2: bookStore 基础（路径布局 + 原子 YAML + 格式探测）

**Files:**
- Create: `electron/main/bookStore/paths.ts`
- Create: `electron/main/bookStore/docStore.ts`
- Create: `electron/main/bookStore/format.ts`
- Create: `electron/main/bookStore/docStore.test.ts` + `format.test.ts`
- Test helper: `tests/tmp.ts`（`mkTmpBook(): string` 建临时目录 + `afterAll` 清理，两个测试共用）

**Interfaces:**
- Produces:
  - `paths.ts`: `bookJsonPath(p), chaptersDir(p), chapterFile(p,id), volumesDir(p), volumeFile(p,id), charactersDir(p), characterFile(p,id), worldDir(p), worldEntryFile(p,category,id), plotlinesDir(p), choicesDir(p), foreshadowFile(p), backupRoot(p), backupStamp(tsIso)→'.migration-backup/<ts>'`；`categorySlug(c: SettingCategory): string` = c 本身（枚举已是英文）。
  - `docStore.ts`: `readYamlFile<T>(abs: string): T`（不存在抛 `ENOBOOK: <path>` 前缀错误）；`writeYamlFileAtomic(abs: string, obj: unknown): void`（同级 `.tmp-<rand>` 写完 rename，自动 mkdir 父目录）；`listYamlFiles(dirAbs): string[]`（目录不存在返回 []，只列 `*.yaml`）。
  - `format.ts`: `detectFormat(projectPath: string): 'v2' | 'v1' | 'invalid'`——book.json 存在且 parse 得 formatVersion===2 → v2；`.novelwriter.json` 或 `.novelwriter.json.migrated` 存在 → v1；否则 invalid。（注意：`.migrated` 后缀文件的存在也算 v1 触发再迁移？否——`.migrated` 仅当 book.json 缺失才视为未迁 v1；book.json 在→v2，先判 v2。）
- Consumes: Task 1 `FORMAT_VERSION`。

- [ ] Step 1: 写失败测试：writeYaml 后 readYaml 回读相等（含中文键值/多行字符串）；父目录自动建；rename 原子性——写后目录中无 `.tmp-` 残留；detectFormat 对 空目录='invalid'、v1 标记='v1'、book.json(v2)='v2'、v2 与旧标记并存='v2'。
- [ ] Step 2: FAIL 确认后实现三文件（`yaml.load` js-yaml v4 默认安全；`yaml.dump(obj,{noRefs:true, lineWidth:120})`）。
- [ ] Step 3: PASS + 全门。
- [ ] Step 4: Commit `feat(bookstore): path layout, atomic yaml doc store, format detection`。

### Task 3: 章节 front-matter + v1→v2 就地迁移器（含备份与报告）

**Files:**
- Create: `src/common/chapterDoc.ts` + `src/common/chapterDoc.test.ts`（`serializeChapterDoc(meta: ChapterMeta, body): string` 与 `parseChapterDoc(raw): {meta, body}`——格式 `---\n<yaml>\n---\n\n<body>`；无 front-matter 抛 `FRONTMATTER_MISSING: <id>`；body 原样保留空行；body 中部的 `---` 不误判——只认起始第一个分隔块）
- Create: `electron/main/bookStore/migrate.ts` + `migrate.test.ts`
- Modify: `electron/main/ipc/modules/project.ts`（`project:open` 内：detectFormat==='v1' 时先 `migrateBook()` 再按 v2 读 book.json 返回；`project:create` 改为建 v2 骨架：book.json + chapters/volumes/characters/world 目录 + foreshadow.yaml 空台账（`{entries:[]}`），不再写 `.novelwriter.json`；返回 ProjectData 含 `migration: null`）

**Interfaces:**
- Produces:
  - `migrateBook(projectPath: string): MigrationReport`——语义钉死：
    1. `backupRoot` 下按当前时间戳新建目录，整本复制（不含既有 `.migration-backup`）；复制失败→抛错，书目录原样未动。
    2. `.novelwriter.json` → book.json（name/type/config 原样，id=randomUUID，synopsis:''）。
    3. `chapters/NNN-标题.md` → `chapters/<uuid>.md`：front-matter{title=正文首行 `# ` 优先、否则文件名去 `NNN-` 前缀；order=文件名数字；status:'draft';volumeId:null}，正文原样。
    4. `characters/*.json` → `characters/<原id>.yaml`：CharacterV2 转换；`relationships[]`（v1 {characterName,...}）→ EntityLink：按 name 全库**唯一**匹配到 id 才连边（kind=relationship，note=description）；歧义/无匹配→丢弃该边并向 warnings 追加 `关系丢弃: <角色名>→<对方名>`；tags/其余字段平移；createdAt/updatedAt→ISO。
    5. `settings/<cat>/<id8>-<title>.json` → `world/<cat-slug>/<全id>.yaml`：WorldEntryV2；parentId 按"旧全 id→新 id"映射（v1 文件内容里 id 是全量则不变，前缀 id 场景 remap）；warnings 记录悬挂 parentId→置 null。
    6. 写空 `foreshadow.yaml`（`{entries:[]}`）；`.novelwriter.json` 改名 `.novelwriter.json.migrated`（幂等关键：detectFormat 见 book.json 即 v2）。
    7. 返回 `{backupPath, warnings}`。
  - `validateMigration(projectPath): string[]`（迁移后自检：每个 YAML 过 Task 1 校验器、front-matter 可读、order 无重复——供测试与 project:open 后调用；失败仅记 console.error 不阻塞）。
- Consumes: Task 1 schema、Task 2 paths/docStore/format。
- Produces（供 Task 4+ 复用）: `serializeChapterDoc/parseChapterDoc`（签名如上 Create 行）。

- [ ] Step 1: 写失败测试 `chapterDoc.test.ts`：round-trip 中文标题含 `#`、`/`、emoji 的 body 完整回读；无 front-matter 抛 FRONTMATTER_MISSING；body 中部 `---` 不误判。
- [ ] Step 2: 实现 chapterDoc.ts → PASS（Review Focus 4 钉在此）。
- [ ] Step 3: 写失败迁移测试（tmp 目录造 v1 样本书：2 章含中文标题、3 角色含一对重名"阿明"、1 角色关系指向不存在的"幽灵"、2 设定含 1 悬挂 parentId）：`migrateBook` 后断言 book.json formatVersion=2；章节文件数=2 且文件名是 uuid.md；两个"阿明"相关关系边均进 warnings（丢弃）而唯一名"李四"连边成功；`.novelwriter.json.migrated` 存在、`.novelwriter.json` 不存在；备份目录内仍有原始 v1 文件；断言 `detectFormat` 返回 'v2'（幂等由格式探测挡重入，测试钉这条链路）。
- [ ] Step 4: FAIL 后实现 migrate.ts（逐条按语义 1-7；v1 JSON 解析容错：单文件坏→warnings `跳过损坏文件: <name>` 继续，整体不抛）。
- [ ] Step 5: `project:create`/`project:open` 接线（open 返回 ProjectData 带 migration 报告）；`validateMigration` 在 open 后跑一次。
- [ ] Step 6: PASS + 全门（v1 旧链路 chapter:* 仍走旧实现——Task 4 前迁移书暂时打不开章节列表属预期窗口，测试不依赖 UI；在报告中明示该窗口）。
- [ ] Step 7: Commit `feat(bookstore): chapter front-matter codec + in-place v1-to-v2 migration with timestamped backup and report`。

### Task 4: 章节仓库 v2 + chapter:* 处理器重写（消费 Task 3 的 front-matter 编解码）

**Files:**
- Create: `electron/main/bookStore/chapters.ts` + `chapters.test.ts`
- Modify: `electron/main/ipc/modules/chapter.ts`（全部 7 通道改调 repository，旧字符串手术全删）
- Modify: `src/renderer/pages/Workspace/hooks/useEditorSession.ts`、`src/renderer/components/Explorer/ChapterTree.tsx` 调用点（通道形状兼容则不动；chapter:getAll 的 content 自此不含 front-matter）

**Interfaces:**
- Consumes: Task 3 `serializeChapterDoc/parseChapterDoc`、Task 1 `ChapterMeta`、Task 2 docStore/paths。
- Produces — `bookStore/chapters.ts`:
  - `listChapters(p): Chapter[]`（解析全部，按 meta.order 升序；**renderer 拿到的 content 不含 front-matter**；wordCount=countWords(body)；id=文件名 uuid；单文件 parse 失败 console.warn 跳过，不整体抛）
  - `createChapter(p, title, volumeId?): Chapter`（body 初始 `# ${title}\n\n`，与 v1 手感一致）
  - `updateChapter(p, id, patch: Partial<Pick<ChapterMeta,'title'|'volumeId'|'status'>> & { content: string }): Chapter`（重算 wordCount；**文件名不动**）
  - `deleteChapter(p, id): boolean`（不存在返回 false）
  - `renameChapter(p, id, newTitle): Chapter`（=updateChapter 的 title 别名）
  - `moveChapter(p, id, toOrder: number): boolean`（order 重排，受影响文件各重写一次 meta）
  - `getChapter(p, id): Chapter | null`
- IPC 层：通道名与现有入参形状不变（`chapter:update` 仍收整 Chapter 对象——repository 取 id+patch；`chapter:reorder` fromId/toId 语义="把 from 移到 to 所在 order 位"）；status 自此真实化。

- [ ] Step 1: 失败测试 chapters.ts（tmp 书目录）：create→list 顺序对；update 改 title 后文件名不变且 front-matter 已更新；move 交换两章后 order 无重复且正文不串；delete 幂等；损坏 front-matter 文件 list 时被跳过（console.warn）而不整体抛。
- [ ] Step 2: FAIL→实现 chapters.ts→PASS。
- [ ] Step 3: 重写 modules/chapter.ts 七个 handler 为薄委托（一行调用+错误透传）；全门；grep：该文件内零 `fs.`、零 `split('-')`、零 `padStart`。
- [ ] Step 4: Commit `feat(bookstore): v2 chapter repository, drop filename string surgery`。

### Task 5: 卷一等公民（repository + 通道 + 章节树分组与卷管理 UI）

**Files:**
- Create: `electron/main/bookStore/volumes.ts`、`electron/main/ipc/modules/volume.ts`
- Create: `src/renderer/components/Explorer/VolumeManager.tsx`（卷头右键菜单组件，可并入 ChapterTree 文件——裁定：独立文件供树复用）
- Modify: `electron/main/ipc/handlers.ts`（注册）、`electron/preload/index.ts`、`src/common/ipc.ts`（`RendererToMainRequests`/`NovelWriterApi` 加 volume 组）、`src/renderer/hooks/useIPC.ts`（`useVolume`）、`src/renderer/components/Explorer/ChapterTree.tsx`（按卷分组渲染+卷操作菜单）、`src/renderer/pages/Workspace/hooks/useEditorSession.ts`（createChapter 传当前卷 id）

**Interfaces:**
- Produces:
  - volumes.ts：`listVolumes(p): VolumeDoc[]`（order 升序）、`createVolume(p, title): VolumeDoc`、`renameVolume(p, id, title): VolumeDoc`、`deleteVolume(p, id): boolean`（其下章节 volumeId→null，单事务内逐章 updateChapter）、`reorderVolumes(p, fromId, toId): boolean`、`moveChapterToVolume(p, chapterId, volumeId | null): Chapter`。
  - 通道：`volume:getAll/create/rename/delete/reorder`（参数形状=chapter 组惯例 `{projectPath, ...}`）+ `chapter:moveToVolume`。
  - `useVolume()` hooks：同名六函数薄包装。
  - ChapterTree：顶层分组=卷（含"未分卷"桶，volumeId=null 归此），卷节点显示 `title（N 章）`；卷右键=新建/重命名/删除(二次确认 Modal，文案含"其下 N 章将回到未分卷")/上移下移；章右键（现有菜单基础上）加"移动到卷"子菜单列全部卷+未分卷。
- Consumes: Task 4 repository。

- [ ] Step 1: volumes.ts tmp 测试：deleteVolume 后其章节 volumeId=null 且章文件仍在；moveChapterToVolume 更新 front-matter 且 order 不变；review-focus-5 场景（建卷A/B→3章入A→删A→列"未分卷"3章）。
- [ ] Step 2: 失败→实现→PASS。
- [ ] Step 3: IPC/preload/hooks 接线（typecheck 即清单）；ChapterTree 分组与菜单 UI（headless：静态走查+typecheck，交互项进人工冒烟清单：分组显示、移卷、删卷确认文案）。
- [ ] Step 4: 全门+commit `feat(volumes): first-class volumes in store, facade and chapter tree UI`。

### Task 6: 人物卡 v2（repository + 通道重写 + 关系按 id 编辑/弧线 UI）

**Files:**
- Create: `electron/main/bookStore/characters.ts`
- Modify: `electron/main/ipc/modules/character.ts`（走 repository；create/update 前跑 `validateCharacterV2` + 引用检查：relationships/links 的每个 targetId 必须是本书角色/设定/卷 id 之一，违反→抛 `REF_BROKEN: <targetId>`）
- Modify: `src/renderer/components/Explorer/CharacterPanel.tsx`（Modal 表单升级：目标动机/缺陷字段入表；关系编辑器=对方角色 Select（列表来自 character:getAll）+kind 输入；成长弧线=可增删行的 {title, summary}；列表项副标题显示关系数与弧线阶段数）
- Create: `electron/main/bookStore/characters.test.ts`

**Interfaces:**
- Produces：characters.ts `listCharacters(p): CharacterV2[]`、`createCharacter(p, seed: {name;gender;role}): CharacterV2`（默认空字段+ISO 时间戳）、`updateCharacter(p, full: CharacterV2): CharacterV2`、`deleteCharacter(p, id): boolean`（**其他角色指向它的 relationships 保留但 UI 显示"已删除角色"降级，不级联删**——裁定入 warnings-free 设计；不做引用清理，M4 AI 整理时再治）。
- 通道名不变；`Character`（ipc.ts）与 CharacterV2 的渲染层接缝：character:getAll 返回 CharacterV2[]，UI 类型改用 schema 导入。

- [ ] Step 1: tmp 测试：create→update 加指向存在角色的关系边成功；update 带不存在 targetId 抛 REF_BROKEN；delete 后他人 edges 原样保留。
- [ ] Step 2: 实现 repository+handler。
- [ ] Step 3: CharacterPanel UI（headless 门=typecheck/lint；人工冒烟项写入报告：新建角色→给两角色建关系→重开面板关系显示名字由 id 解析而来）。
- [ ] Step 4: 全门+commit `feat(characters): v2 character cards with id-based relationships and arc`。

### Task 7: 世界设定 v2（repository + 通道重写 + SettingPanel 适配）

**Files:**
- Create: `electron/main/bookStore/world.ts` + `world.test.ts`
- Modify: `electron/main/ipc/modules/setting.ts`（同 Task 6 模式：docStore + validateWorldEntryV2 + parentId/links 引用检查；**旧"文件名前 8 位定位文件"路径全删**）
- Modify: `src/renderer/components/Explorer/SettingPanel.tsx`（类型切 WorldEntryV2；parentId 编辑器可选——保持现有分类树 CRUD 交互，不扩 UI 功能）

- [ ] Step 1: tmp 测试：create/update/delete 按全 id 定位；中文标题设定 rename 不动文件名；树状 parentId 挂两层读取正确。
- [ ] Step 2-3: 实现+面板切类型（UI 行为零变化裁定）。
- [ ] Step 4: 全门+commit `feat(world): v2 world entries keyed by full id, drop filename-prefix lookup`。

### Task 8: 剧情线/关键选项/伏笔台账 数据层（无 UI）

**Files:**
- Create: `electron/main/bookStore/narrative.ts`（三个域的 repository 同文件——共享 foreshadow.yaml/plotlines//choices/ 目录读写，同域变更一起测）+ `narrative.test.ts`
- Create: `electron/main/ipc/modules/narrative.ts`
- Modify: `ipc/handlers.ts`、`preload/index.ts`、`src/common/ipc.ts`、`src/renderer/hooks/useIPC.ts`（`useNarrative` hooks：plotline/choice/foreshadow 各 getAll/create/update/delete + `resolveForeshadow(p, id, resolvedChapterId)`、`abandonForeshadow(p, id)`）

**Interfaces:**
- Produces（repository）：`listPlotlines/createPlotline/updatePlotline/deletePlotline`、`listChoices/createChoice/updateChoice/deleteChoice`（choice 挂章：`ChoiceNodeV2.chapterId` 引用检查）、`readLedger/writeLedger/upsertForeshadow/resolveForeshadow/abandonForeshadow`——status 转移唯一合法路径 open→resolved|abandoned、resolved→open（撤回复置 resolvedChapterId=null）、abandoned→open。
- 通道：`plotline:*`、`choice:*`、`foreshadow:get/upsert/resolve/abandon`，参数惯例 `{projectPath, ...}`。

- [ ] Step 1: 失败测试：foreshadow 状态机非法转移（open→直接 resolved 无 chapterId）抛错；upsert 新建+按 id 更新合并；ledger 原子写。
- [ ] Step 2-3: 实现+接线。
- [ ] Step 4: 全门+commit `feat(narrative): plotline/choice/foreshadow repositories and facade (no UI yet)`。

### Task 9: 文件监听 + 缓存失效 + book:changed + 脏冲突警告

**Files:**
- Create: `electron/main/bookStore/watcher.ts` + Modify repository 侧：给 chapters/characters/world/volumes/narrative 五个 repository 加模块级缓存 `Map<projectPath, {loaded, docs}>` 与 `invalidate(projectPath, relPath)`
- Modify: `electron/main/ipc/modules/project.ts`（open 成功后 `startWatching(projectPath, win)`；切换/关闭项目 `stopWatching()`）
- Modify: `electron/preload/index.ts`（`on.bookChanged`）、`src/common/ipc.ts`（`BookChangedEvent { paths: string[] }`）、`src/renderer/hooks/useBookEvents.ts`（新）
- Modify: `src/renderer/pages/Workspace/index.tsx` + `useEditorSession.ts`（订阅 bookChanged：非当前章的变更→静默 refetch session/chapters；**当前章文件被外部改且本地 isDirty**→ antd `Modal.warning`「外部修改了这个文件」按钮组"保留我的（重写盘）/重新加载（弃本地）"，二选一前暂停该章自动 flush；不自动合并）
- Modify: `electron/main/bookStore/paths.ts`（新增导出 `domainOf(relPath: string): 'chapters'|'characters'|'world'|'volumes'|'narrative'|null`——相对路径前缀→缓存域映射）

**Interfaces:**
- Produces: `startWatching(projectPath, win: BrowserWindow): void`、`stopWatching(): void`；repository 契约——`listX/getX` 命中缓存免 IO、`updateX/deleteX` 写完就地更新缓存、`invalidateCache(projectPath)` 分域清空；watcher 事件→300ms debounce→`domainOf` 分域失效并 `win.webContents.send('book:changed', {paths: [...相对路径]})`；`useBookEvents(handlers)` renderer 订阅薄包装。缓存测试语义：写入新内容后 list 立即读到新值（无需重启）；invalidate 后 list 重读磁盘。

- [ ] Step 1: node 层测试 watcher：tmp 书 startWatching→外部改 characters yaml→断言 invalidate 被对应域调用且收到一次 book:changed（debounce 内多写合并成 1 事件）。
- [ ] Step 2: 失败→实现（fs.watch recursive:true；EPERM/断开→3 次重试后 console.error 停摆，不崩应用）。
- [ ] Step 3: repository 缓存接线（list/get/update 三处各测一次缓存命中/失效语义）。
- [ ] Step 4: renderer 侧静态走查冲突路径：dirty+外部改→Modal、保留我的→重写盘、重新加载→setValue+清 dirty；beforeunload 与自动保存在冲突弹窗期间对当前章短路（isDirty 暂停 flush 的标志位）。
- [ ] Step 5: 全门+commit `feat(bookstore): fs watcher, cache invalidation, book:changed events and external-edit conflict modal`。

### Task 10: 迁移报告 UI + 格式公开文档 + 端到端收口

**Files:**
- Modify: `src/renderer/pages/Home/index.tsx` 与 `src/renderer/components/Dialogs/ProjectDialog.tsx`（open 成功后若 `project.migration` 非 null：message.success `已升级为新版数据目录（备份见 <backupPath>）`；warnings.length>0 再开一个可折叠列表 Modal 列 warnings 原文）
- Create: `docs/BOOK_FORMAT.md`（v2 全目录树、每类文件字段表、front-matter 完整例、`.migration-backup/` 只读约定、`.ai/` M4 预留说明、"第三方 AI 工具如何安全读写一本书"操作守则：原子写+先 validate+不重命名文件）
- Modify: `README.md`（数据目录段落指向 BOOK_FORMAT.md；目录树补 bookStore/）
- Modify: `docs/DEVELOPMENT.md`（M2 完成行）
- E2E 测试：Create `electron/main/bookStore/e2e.test.ts`——tmp 造 v1 书→migrateBook→listChapters/listCharacters/listWorld/listVolumes 全走 v2 repository 断言计数/标题/关系边数与 v1 输入一致→validateMigration []→二次 open 不再迁移。

- [ ] Step 1: 先写 e2e 失败测试（此时各件已存在，预期绿→若非绿即找到跨任务接缝 bug，修）。
- [ ] Step 2: UI 接线 + BOOK_FORMAT.md（字段表逐字抄 schema.ts，勿自创）。
- [ ] Step 3: 全门 + 人工冒烟总清单（含 M1 closeout 7 项 + 本计划新项：打开旧书看迁移 toast、外部编辑器改角色卡名字应用内秒级刷新、dirty 冲突二选一）。
- [ ] Step 4: Commit `feat(m2): migration reporting UI, public book format spec, end-to-end data foundation`。

---

## M2 完成定义（DoD）

- 全门绿；`ipc/modules/*` 对书数据的裸 fs 手术清零（grep 证明）；`chapter:`/`setting:` 旧字符串手术函数（`split('-')`、`padStart(3,'0')`、前 8 位匹配）不存在。
- e2e：v1 样本书一键迁移→v2 全链路读取正确→幂等。
- `docs/BOOK_FORMAT.md` 存在且与 schema 一致（审查员比对）。
- 人工冒烟：Review Focus 1-5 真机过验（发起人醒后补做，欠账同 M1）。
- 图谱视图/录入 UI（剧情线/选项/伏笔）明确**不在**本里程碑。
