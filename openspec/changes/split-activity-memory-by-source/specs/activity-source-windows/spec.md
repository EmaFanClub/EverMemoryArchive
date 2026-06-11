## ADDED Requirements

### Requirement: Activity 记录支持可选来源元数据

系统 MUST 支持在 `kind` 为 `activity` 的短期记忆记录上保存可选来源元数据。

#### Scenario: 会话 activity 写入会话来源

- **WHEN** 系统从会话 `123` 的 conversation rollup 中创建 activity
- **THEN** activity 记录必须包含 `conversationId: 123`
- **AND** activity 记录不需要通过 `sourceType` 标识会话来源

#### Scenario: 后台 activity 写入后台来源

- **WHEN** 系统从非会话的后台 activity 任务中创建 activity
- **THEN** activity 记录必须包含 `sourceType: "background"`
- **AND** activity 记录不需要额外的来源 id

#### Scenario: 无来源元数据的 activity 归入未分类

- **WHEN** activity 记录没有 `conversationId` 且没有 `sourceType`
- **THEN** 系统必须将该记录视为属于未分类来源

#### Scenario: 冲突来源元数据被规范化

- **WHEN** activity 记录同时具有 `conversationId` 和 `sourceType: "background"`
- **THEN** 系统必须优先按 `conversationId` 将该 activity 解析为会话来源
- **AND** 新写入必须避免创建冲突的来源元数据

### Requirement: Activity prompt 按来源分组

系统在 system prompt 中渲染 activity 上下文时，MUST 按来源分组，而不是渲染为一个 actor 级 activity 列表。

#### Scenario: 多个会话来源分开展示

- **WHEN** prompt activity 上下文包含来自会话 `123` 和 `456` 的记录
- **THEN** system prompt 必须为会话 `123` 和会话 `456` 分别渲染 activity 分组
- **AND** 某个会话的 activity 记录不得出现在另一个会话分组下

#### Scenario: 后台来源和未分类来源分开展示

- **WHEN** prompt activity 上下文同时包含后台 activity 和未分类 activity
- **THEN** system prompt 必须分别渲染后台活动分组和未分类活动分组

#### Scenario: 每个来源拥有独立 prompt 窗口

- **WHEN** 某个来源有超过 5 条可进入 prompt 上下文的 activity 记录
- **THEN** system prompt 中该来源最多只能包含 5 条 activity 记录
- **AND** 其他来源的记录不得占用该来源的 5 条窗口额度

#### Scenario: 会话标签在渲染时生成

- **WHEN** prompt 渲染会话 activity 分组
- **THEN** 如果当前会话元数据可用，分组标签必须由会话元数据生成
- **AND** 如果会话元数据不可用，分组标签必须回退到稳定的会话 id 标签

### Requirement: Activity rollup 按来源执行

系统 MUST 为每个 activity 来源独立触发并执行 activity-to-day rollup。

#### Scenario: 单个会话达到 rollup 阈值

- **WHEN** 会话 `123` 有 5 条 pending activity 记录，且会话 `456` 少于 5 条 pending activity 记录
- **THEN** 系统必须为会话 `123` 触发 rollup
- **AND** rollup snapshot 必须只包含来自会话 `123` 的 pending activity 记录
- **AND** 会话 `456` 的 pending 记录必须保持未处理状态

#### Scenario: 后台来源达到 rollup 阈值

- **WHEN** 后台来源有 5 条 pending activity 记录
- **THEN** 系统必须为后台来源触发 rollup
- **AND** rollup snapshot 必须只包含 pending 后台 activity 记录

#### Scenario: 未分类来源达到 rollup 阈值

- **WHEN** 未分类来源有 5 条 pending activity 记录
- **THEN** 系统必须为未分类来源触发 rollup
- **AND** rollup snapshot 必须只包含 pending 未分类 activity 记录

#### Scenario: Rollup 只标记已消费的来源记录

- **WHEN** 一个 source-scoped activity rollup 成功完成
- **THEN** 系统必须只将该 rollup snapshot 中包含的 activity 记录标记为 processed
- **AND** 其他来源的 activity 记录必须保持原有 processed 状态

### Requirement: 来源级 rollup 安全更新共享 day memory

系统在应用来源级 activity rollup 时，MUST 保留现有 actor/date 维度的 day memory 结构。

#### Scenario: 来源 rollup 更新已有 day memory

- **WHEN** 来源级 activity rollup 目标日期已经存在 day memory
- **THEN** 系统必须将该来源的 activity 内容合并进已有 day memory
- **AND** 系统必须保留 day memory 中已经存在的无关内容

#### Scenario: 并发来源 rollup 不重复处理同一来源

- **WHEN** 两个 worker 同时尝试为同一个 actor 和同一个来源启动 threshold rollup
- **THEN** 系统最多只允许一个该 actor/source 组合的 threshold rollup 运行

#### Scenario: 并发来源 rollup 不覆盖共享 day memory

- **WHEN** 同一个 actor 的不同来源 rollup 到同一条 day memory
- **THEN** 系统必须串行化更新 actor 级 day memory 的写入
- **AND** 最终 day memory 必须包含每个成功来源 rollup 的贡献内容
