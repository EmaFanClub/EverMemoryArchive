# RFC-0008 EMA 数据存储、配置体系与工作区边界 (EMA Data and Config)

[English](RFC-0008-ema-data-and-config.md)

> **状态**：In Review（草案供董事会评审）  
> **修订**：v1.0.0  

- Feature Name: `ema-data-and-config`
- Start Date: 2026-11-13
- RFC PR: [EmaFanClub/EverMemoryArchive#54](https://github.com/EmaFanClub/EverMemoryArchive/pull/54)
- Implementation PR: [EmaFanClub/EverMemoryArchive#54](https://github.com/EmaFanClub/EverMemoryArchive/pull/54)

## Summary
[summary]: #summary

本 RFC 规范 EverMemoryArchive (EMA) 运行时与离线训练全链路的**数据存储拓扑（Data Storage）**、**配置体系（Configuration）**、**工作区边界（Workspace Boundaries）**以及**核心生命周期场景（启动与训练）**：

0. **Actor 概念与归属层级（引用 [RFC-0001](RFC-0001-ema-worlds-and-actors.zh.md)）**：在 EMA 架构中，与外部世界（`EmaWorld`）交互的 **Actor（`EmaActor`）即 EMA Agent**；每一个 EMA Agent 作为一等公民归属于 **Penguin Project** 或 **Penguin Company（Organization）**（位于 `<app_data_dir>/agents/<agent_id>/` 及组织目录 `<app_data_dir>/organizations/<org_id>/` 下），其身份、记忆与专属配置跟随 Agent 终身存续，与单次会话所挂载的工作目录解耦。
1. **数据分层存储（Data Storage）**：严格划分为**同机共享 World 状态库**（`~/.penguin/data/ema/worlds/*.sqlite`，由单实例 World HTTP Server 统一持有）、**Agent 专属状态与长期记忆**（`<app_data_dir>/agents/<agent_id>/agent_state/`）以及 **Persona 离线训练资产**（`<personas_dir>/<persona_id>/`）。
2. **显式 TOML 配置与 Panic-First 原则（Config）**：
   - **默认不使用环境变量（`process.env.*`）**：除非有明确理由，所有运行时与 CLI 配置一律走 **Agent 专属 `config.toml`** 与 **全局 `config.toml`**（`~/.penguin/data/ema/config.toml`）。
   - **默认不 Fallback，而 Prefer Panic**：除非有明确理由，禁止编写静默吞错（`catch {}`）或多级候选路径/端口猜测链；缺配、文件不存在或服务不可达时立即 Panic。
3. **Workspace 的纯粹工作目录定位（Workspace）**：`workspace` 是 EMA Agent 当前会话的工作目录，**绝不存储 EMA 的记忆（Memory）和 World 状态信息**。EMA Agent 运行于 `workspace-write` 沙箱中，用户可以：
   - **a. 像正常的 Coding Agent 一样使用（`workspace = some repo`）**：将 `workspace` 指向任意代码仓库进行研发，不污染代码树；
   - **b. 把 EMA 当作 Bot 使用（将图片等交付物存入 `workspace`）**：让 EMA 将生成、下载或处理的图片持久化保存在 `workspace` 中（`scratchpad` 虽可暂存中间产物，但随会话生命周期可能丢失）。
4. **核心生命周期场景**：规范「正常在某 `workspace` 启动 EMA Agent」与「离线训练 EMA Agent（`wash` -> `train` -> `persona sync`）」两个端到端标准场景的数据流与配置流。

---

## Motivation
[motivation]: #motivation

### 0. 明确 Actor 的归属：Actor 是归属于 Project / Company 的 EMA Agent

在 [RFC-0001 (Ema Worlds and Actors)](RFC-0001-ema-worlds-and-actors.zh.md) 中，我们定义了 `EmaActor` 接口（`{ id, name, session, agentId }`）作为与 `EmaWorld` 交互的主体。在工程落地中，必须明确其宿主归属关系：
- **Actor 就是 EMA Agent**：每个 Actor 对应 PenguinHarness 中的一个具名 EMA Agent（例如 `sakana_kawaii`、`sakana_chan`、`aoi_rei`、`shirobana`）。
- **EMA Agent 属于 Penguin Project / Company**：EMA Agent 并非寄居在某个代码仓库子目录下的临时配置，而是注册在 Penguin Project（`<app_data_dir>/agents/<agent_id>/`）或 Penguin Company（`<app_data_dir>/organizations/<org_id>/`）下的持久实体。正因如此，同一个 EMA Agent 可以在不同时间、不同会话中挂载不同的 `workspace` 工作目录，而始终保持完整、连续的人格与长期记忆。

### 1. 终结多 Agent 各自直连 World 数据库与平台网关的冲突

此前若每个 EMA Agent 在各自的进程或沙箱中自行初始化 `QQWorld`、`WebWorld` 或直接打开各自的 SQLite 文件，会导致：
- **连接风暴与网关冲突**：多个 Agent 重复建立 QQ Bot / Bilibili 网关长连接，触发平台风控或消息重复消费；
- **状态割裂与写锁争用**：同一台机器上的 World 数据散落在不同目录或因多进程并发写同一个 SQLite 触发锁冲突；
- **沙箱越权隐患**：为了直写宿主机公共目录的 SQLite，迫使 Agent 会话开启 `danger-full-access`，破坏了 `workspace-write` 沙箱隔离。

因此，同一台机器上的所有 World 数据必须集中存放在统一目录（`~/.penguin/data/ema/worlds/`），由宿主侧唯一的 **Shared World HTTP Server** 统一持有连接，沙箱内的 Agent 统一通过 `ema.js world ls | get | post` 走 HTTP 协议访问。

### 2. 根除隐式环境变量（`process.env`）与静默回退（Fallback）带来的脆弱性

在早期实现中，`world-server.ts` 与 `ema.js` 大量混用 `process.env.EMA_*` 环境变量与多层回退链（如端口回退、多 URL 顺序探测、多目录猜测 `personas` 路径、`catch {}` 静默忽略错误）。这带来了严重的工程隐患：
- **状态不可复现**：不同 Shell 或子进程继承的环境变量不一致，导致 Agent 有时连测试库、有时连生产库；
- **故障被静默掩盖**：当配置文件路径写错或服务未启动时，程序静默回退到临时空库或空目录，表面“运行成功”实则丢失数据。

确立 **「默认走 Agent 专属 `config.toml` + 全局 `config.toml`，绝不依赖隐式环境变量」** 与 **「Prefer Panic over Fallback」** 两条铁律，能保证任何配置缺失或连接异常在第一现场立即暴露。

### 3. 解耦「伴侣自身记忆/世界状态」与「用户工作区（`workspace`）」

EMA Agent 既是终身伴侣，又是具备完整工具调用能力的智能体。如果将 EMA 的记忆索引、检查点或 World SQLite 混入当前会话的 `workspace`：
- 当用户把 EMA 当作 **Coding Agent** 在某个 Git 仓库（`workspace = some repo`）中工作时，伴侣的私密记忆和 `*.sqlite` 数据库会污染用户的代码仓库；
- 当用户切换 `workspace` 到另一个项目时，伴侣就会“失忆”。

反之，将记忆与 World 状态彻底移出 `workspace` 后，`workspace` 回归纯粹的**工作与交付目录**：既能干净地承载代码仓库开发，又能在用户把 EMA 当作 **Bot** 时，作为持久保存图片、媒体与文档的安全目录（避免放在临时 `scratchpad` 中因会话清理而丢失）。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 0. Actor 概念与归属拓扑（引用 [RFC-0001](RFC-0001-ema-worlds-and-actors.zh.md)）

根据 [RFC-0001](RFC-0001-ema-worlds-and-actors.zh.md)，`EmaActor` 是感知外部 `EmaWorld` 并对特定 `Part` 执行 `world.interact(ctx, actor, id, action, payload)` 的行为主体：

```ts
export interface EmaActor {
  /** 逻辑 Actor 标识符 */
  readonly id: string;
  /** 显示名称（如 "大肥鱼"、"苍星怜"） */
  readonly name: string;
  /** 绑定的 Penguin 路由会话 ID（Route Session） */
  readonly session: string;
  /** 归属于 Penguin Project / Company 的底层 Agent ID（如 "sakana_kawaii"） */
  readonly agentId?: string;
}
```

其归属关系满足以下三层拓扑：

```
Penguin Project (<app_data_dir>) / Penguin Company (<app_data_dir>/organizations/<org_id>)
  └── EMA Agent / Actor (<app_data_dir>/agents/<agent_id>/)
        ├── Agent State (agent_state/)       <-- 终身伴侣身份 (AGENTS.md)、专属配置 (config.toml)、长期记忆 (memory/)
        ├── Session Scratchpad (scratchpad/) <-- 单次会话临时草稿（可能随会话清理而丢失）
        └── Active Session (workspace-write) <-- 挂载外部工作目录 Workspace (CWD)，通过 HTTP 访问同机共享 World
```

---

### 1. 数据存储架构（Data Storage）

EMA 的全部数据按职责与生命周期存放在三个严格隔离的物理位置：

| 存储层级 | 标准路径 | 存储内容 | 读写权限与持有者 |
| :--- | :--- | :--- | :--- |
| **1. 同机共享 World 数据** | `~/.penguin/data/ema/worlds/` | `web-world.sqlite`<br>`qq-world.sqlite`<br>`bilibili-world.sqlite`<br>`channel-world.sqlite` | **宿主单实例 World HTTP Server 独占读写**；沙箱内 Agent 文件系统只读（`EROFS`），仅通过 HTTP API 访问。 |
| **2. Actor（EMA Agent）专属数据** | `<app_data_dir>/agents/<agent_id>/agent_state/` | `AGENTS.md`（人格与热记忆索引 [RFC-0004](RFC-0004-in-context-memory-index-and-os.zh.md)）<br>`config.toml`（Agent 专属配置）<br>`memory/user/`（跨工作区长期记忆）<br>`memory/<workspace>/`（工作区记忆）<br>`workbenches/companion_portal/` | 归属于 **Penguin Project / Company** 下的该 EMA Agent；由认知巩固/梦境引擎（[RFC-0006](RFC-0006-memory-compaction.zh.md) / [RFC-0007](RFC-0007-dreaming-and-background-consolidation.zh.md)）与记忆工具维护。 |
| **3. Persona 训练资产库** | `<personas_dir>/<persona_id>/` | `persona.toml`（训练与角色定义）<br>`script/chapters.toml` & `autonomy.toml`<br>`washed-dataset.json`<br>`trained-checkpoint.json`<br>`AGENTS.md`（编译产物） | 由离线清洗与训练流水线（`ema.js wash \| train \| persona`，[RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) / [RFC-0005](RFC-0005-script-to-persona-memory-training.zh.md)）读写。 |

> **同机单实例不变量**：在同一台物理机/宿主机上，所有 `EmaWorld` 的持久化 SQLite 数据库统一存放在 `~/.penguin/data/ema/worlds/` 下。禁止不同的 EMA Agent 各自创建独立的 `QQWorld` 实例或各自直连 SQLite。

---

### 2. 配置体系（Configuration Architecture）

#### 2.1 两条核心配置原则

1. **除非有明确理由，不使用环境变量（No `process.env.*` by Default）**：
   - 禁止通过 `process.env.EMA_*` 或隐式环境变量传递数据库路径、端口、网关地址、角色目录或群号列表。
   - 默认一律从 **Agent 专属 `config.toml`** 与 **全局 `config.toml`**（`~/.penguin/data/ema/config.toml`）读取配置。
2. **除非有明确理由，不 Fallback，而 Prefer Panic（Fail-Fast）**：
   - 当 `config.toml` 文件不存在、必填字段缺失或类型错误、World HTTP 端口绑定失败（如 `EADDRINUSE`）、HTTP 请求失败或 JSON 解析异常时，必须**立即抛出显式 Panic 错误**（如 `[EMA Config Panic]` / `[EMA World Server Panic]` / `[EMA World CLI Panic]`）。
   - 严禁编写 `catch {}` 静默吞错、多 URL 轮询猜测链或回退到硬编码临时路径。

#### 2.2 全局配置文件：`~/.penguin/data/ema/config.toml`

定义同机共享的目录位置、World HTTP Server 监听地址及四个标准 World 的挂载参数：

```toml
# Global EMA Configuration (~/.penguin/data/ema/config.toml)
app_data_dir = "/home/rei/.penguin/data/default_project"
personas_dir = "/home/rei/work/EverMemoryArchive/personas"

[world]
host = "127.0.0.1"
port = 17480
url = "http://127.0.0.1:17480"
data_dir = "/home/rei/.penguin/data/ema/worlds"

[world.web]
db_path = "/home/rei/.penguin/data/ema/worlds/web-world.sqlite"
initial_sessions = ["default"]

[world.qq]
db_path = "/home/rei/.penguin/data/ema/worlds/qq-world.sqlite"
self_id = "1000000001"
gateway_url = "http://127.0.0.1:6099"
gateway_token = ""
groups = ["2000000001"]
private_users = []

[world.bilibili]
db_path = "/home/rei/.penguin/data/ema/worlds/bilibili-world.sqlite"
rooms = ["123456"]
video_targets = ["BV1xx411c7mD"]
dm_targets = ["3000000001"]

[world.channel]
db_path = "/home/rei/.penguin/data/ema/worlds/channel-world.sqlite"
channels = ["ch_ema_minimal_test", "ch_general"]
```

#### 2.3 Agent 专属配置文件：`<app_data_dir>/agents/<agent_id>/agent_state/config.toml`

每个 EMA Agent 在其 `agent_state/` 下持有专属 `config.toml`，声明自身 Actor 身份、归属主人及所连接的共享 World 地址与默认频道：

```toml
# Agent-specific EMA Configuration (<app_data_dir>/agents/sakana_kawaii/agent_state/config.toml)
[agent]
id = "sakana_kawaii"
name = "大肥鱼"
owner = "rei"

[world]
url = "http://127.0.0.1:17480"

[world.web]
channel_id = "web:chatroom:default"
```

#### 2.4 角色训练配置文件：`<personas_dir>/<persona_id>/persona.toml`

用于离线剧本清洗、训练与同步的单一 TOML 配置文件（详见第 4.2 节）。

---

### 3. Workspace 的边界与两种用户使用模式

#### 3.1 核心边界：Workspace 不存记忆与 World 信息

- `workspace`（会话的 `CWD`）**仅作为 EMA Agent 当前会话的工作目录**。
- **不存记忆**：EMA 的人设权重、短期热记忆索引（`AGENTS.md`）与长期情景/事实记忆（`memory/`）全部存储在 `<app_data_dir>/agents/<agent_id>/agent_state/` 中，绝不写入 `workspace`。
- **不存 World 状态**：所有外部世界的消息流水、群聊列表、投递游标全部存储在 `~/.penguin/data/ema/worlds/*.sqlite` 中，绝不写入 `workspace`。
- **`workspace-write` 双重白名单沙箱隔离（目录白名单 + `bin` 可执行文件白名单）**：
  1. **目录读写白名单（`/home/rei` Whitelist）**：Bubblewrap 先以 `--tmpfs /home/rei` 与 `--tmpfs /etc/ssh` 清空家目录与系统 SSH 配置（使 `~/.ssh`、`~/.gnupg`、`web.db`、`ema/worlds/*.sqlite`、`.vault.toml` 及其他仓库在沙箱内完全不存在、不可读），仅只读挂载运行所需的最小运行时与 `config.toml`，并**仅允许读写当前会话的 `workspace`、`scratchpad` 与内存 `/tmp`**，最后执行 `--remount-ro /home/rei` 锁定家目录骨架只读。
  2. **`bin` 可执行文件白名单（需经 EMA Agent Owner 同意）**：Bubblewrap 以 `--tmpfs /usr/bin`（含 `/bin`、`/usr/sbin`、`/usr/local/bin` 等）清空系统命令目录，仅按全局 `~/.penguin/data/ema/config.toml` 的 `[sandbox].allowed_bins` 与 Agent 专属 `config.toml` 的 `[sandbox].owner_approved_bins` 只读挂载白名单内的基础命令（如 `sh`、`bash`、`ls`、`cat`、`node`、`penguin` 等）。任何非白名单二进制（如 `ssh`、`scp`、`sftp`、`curl`、`git`、`python3` 等）在沙箱内均不存在且无法执行；若需要使用，**必须经过 EMA Agent Owner（`owner = "rei"`）同意**并在只读挂载的 `config.toml` 中显式加入 `[sandbox].owner_approved_bins`。

#### 3.2 模式 A：像正常的 Coding Agent 一样（`workspace = some repo`）

用户可以将 EMA Agent 会话的 `workspace` 直接指定为任意代码仓库（例如 `/home/rei/work/my-app`）：
- EMA Agent 拥有伴侣的性格、语气与跨项目长期记忆（知道用户的编码偏好、作息习惯与过往约定）；
- 同时它像标准 Coding Agent 一样在 `workspace` 代码仓库中阅读源码、修改文件、执行测试与构建；
- 因为伴侣记忆与 World 数据均不在 `workspace` 内，代码仓库的 `git status` 保持绝对干净。

#### 3.3 模式 B：把 EMA 当作 Bot（将图片等持久化产物存到 `workspace`）

当用户通过 QQ、Bilibili、Web Companion Portal 或直接对话把 EMA 当作日常陪伴 / 创作 Bot 使用时（例如让 EMA 画一张图、保存表情包、生成纪念卡片或整理相册）：
- EMA 将需要长期保留的图片或文件**直接写入 `workspace`**（例如 `<workspace>/images/2026-11-13-whale.png`）。
- **为什么存 `workspace` 而不是 `scratchpad`**：
  - 会话的 `scratchpad`（`<app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/`）仅用于存放单次推理过程中的临时中间文件；一旦切换会话、重置模型或清理历史会话，`scratchpad` 中的内容可能随之丢失。
  - `workspace` 是用户显式分配给该 Agent 的持久化工作目录，在 `workspace-write` 沙箱内天然可写，且跨越多次会话永久留存，便于用户直接浏览、备份或通过静态服务引用这些图片。

---

### 4. 核心生命周期场景（Scenarios）

#### 4.1 场景一：正常在某 `workspace` 启动 EMA Agent

```
+-----------------------------------------------------------------------------+
| 宿主机共享层 (Host Shared Layer)                                            |
|   ~/.penguin/data/ema/config.toml                                           |
|          │                                                                  |
|          ▼                                                                  |
|   Shared World HTTP Server (http://127.0.0.1:17480)                         |
|     ├── WebWorld       -> ~/.penguin/data/ema/worlds/web-world.sqlite       |
|     ├── QQWorld        -> ~/.penguin/data/ema/worlds/qq-world.sqlite        |
|     ├── BilibiliWorld  -> ~/.penguin/data/ema/worlds/bilibili-world.sqlite  |
|     └── ChannelWorld   -> ~/.penguin/data/ema/worlds/channel-world.sqlite   |
+-----------------------------------------------------------------------------+
           │                                                ▲
           │ 1. 聚合推送 <Input> XML                        │ 3. HTTP GET/POST
           ▼    (penguin input)                             │    (ema.js world ls|get|post)
+-----------------------------------------------------------------------------+
| EMA Agent 会话 (Sandbox: workspace-write)                                   |
|   Actor = EMA Agent (归属于 Penguin Project / Company)                      |
|                                                                             |
|   [Agent State] <app_data_dir>/agents/<agent_id>/agent_state/               |
|     ├── config.toml  (读取 Agent 专属配置，无 process.env)                  |
|     ├── AGENTS.md    (注入锚定人格 P_{u,v} + 内存记忆索引 M_hot)            |
|     └── memory/      (跨会话长期记忆)                                       |
|                                                                             |
|   [Workspace]   /path/to/repo  或  /path/to/bot-gallery/                    |
|     └── 2. 执行代码开发 (模式 A) 或 保存持久图片/文件产物 (模式 B)          |
+-----------------------------------------------------------------------------+
```

**标准启动与运行流程**：
1. **启动共享 World 服务**：宿主加载 `~/.penguin/data/ema/config.toml`，启动单实例 World HTTP Server（监听 `127.0.0.1:17480`），挂载 `WebWorld`、`QQWorld`、`BilibiliWorld` 与 `PenguinChannelWorld`。若配置文件缺失或端口冲突，立即 Panic。
2. **在目标 `workspace` 启动 Agent 会话**：在用户指定的 `workspace`（代码仓库或 Bot 目录）下，以 `{"mode": "workspace-write"}` 沙箱模式启动归属于 Project / Company 的 EMA Agent（如 `sakana_kawaii`）。
3. **加载身份与记忆**：PenguinHarness 自动从 `<app_data_dir>/agents/sakana_kawaii/agent_state/` 加载 `AGENTS.md` 与 `memory/`，此时 `workspace` 内零 EMA 元数据文件。
4. **交互与工作**：
   - 外部世界消息经 `InputBatcher` 聚合后通过 `penguin input` 推入会话；
   - 若需要读写代码或保存生成的图片，Agent 直接在当前 `workspace` 内执行文件操作；
   - 若需要查询世界状态或向 Web/QQ/Bilibili 发送回复，Agent 调用 `ema.js world get|post`（读取 `config.toml` 中的 `http://127.0.0.1:17480`）通过 HTTP 完成交互。
5. **后台记忆巩固与梦境**：后台工作协程（[RFC-0006](RFC-0006-memory-compaction.zh.md) / [RFC-0007](RFC-0007-dreaming-and-background-consolidation.zh.md)）在隔离的临时会话中对路由会话轨迹进行压缩与反事实自省，并将更新后的状态原子写回 `<app_data_dir>/agents/<agent_id>/agent_state/AGENTS.md`。

#### 4.2 场景二：训练 EMA Agent（Offline Script-to-Persona Training）

离线训练完全由 `<personas_dir>/<persona_id>/persona.toml` 单个配置文件驱动（遵循 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 与 [RFC-0005](RFC-0005-script-to-persona-memory-training.zh.md)），不依赖环境变量，也不污染运行时 `workspace`：

```
<personas_dir>/<persona_id>/
  ├── persona.toml                (唯一训练配置源)
  ├── script/
  │     ├── chapters.toml         (日常陪伴原著剧本)
  │     └── autonomy.toml         (自主意识与初遇前同温层剧本)
  │
  ├── [Step 1: pnpm wash --config persona.toml --prompt "..."]
  │     └──> washed-dataset.json  (因果对齐 Input_t -> <OS>_t -> <Action>_t + Golden Exemplars)
  │
  ├── [Step 2: pnpm train --config persona.toml --prompt "..."]
  │     ├──> trained-checkpoint.json (Student 推演 + Teacher 评分 + RSI 人格演化 + 记忆裁剪)
  │     └──> AGENTS.md               (编译生成的角色系统提示词与初始记忆索引)
  │
  └── [Step 3: pnpm persona sync --config persona.toml]
        └──> 同步写入 <app_data_dir>/agents/<agent_id>/agent_state/
               ├── AGENTS.md
               ├── config.toml
               └── workbenches/companion_portal/
```

**三步训练与投产闭环**：
1. **清洗数据集（`wash`）**：读取 `persona.toml` 中指定的剧本文件，在临时训练会话中清洗并因果对齐 `Input_t -> <OS>_t -> <Action>_t`，输出 `<persona_dir>/washed-dataset.json`。
2. **执行 RSI 训练（`train`）**：读取 `washed-dataset.json`，执行多轮 Student 前向推演、Teacher 审稿打分、锚定保真的人格演化与场景记忆压缩；按 `[memory_policy]` 100% 保留初遇前同温层记忆（`pre_meeting_peer`）并裁剪初遇后预演情景记忆（仅保留内化后的人格权重），输出 `trained-checkpoint.json` 与 `<persona_dir>/AGENTS.md`。
3. **同步至 Penguin Agent（`persona sync`）**：将训练收敛的 `AGENTS.md`、专属 `config.toml` 与 `companion_portal` Workbench 同步安装到 `<app_data_dir>/agents/<agent_id>/agent_state/`。此后，该 EMA Agent 即可在任意 `workspace`（场景一）中直接启动并投入陪伴或研发工作。

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 配置加载器接口规范 (`packages/ema/src/config.ts`)

```ts
export const DEFAULT_GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".penguin",
  "data",
  "ema",
  "config.toml",
);

/**
 * 严格加载并校验全局 config.toml。
 * 若文件不存在或任意必填字段缺失，立即抛出 [EMA Config Panic] 错误。
 */
export function loadEmaGlobalConfig(
  configPath: string = DEFAULT_GLOBAL_CONFIG_PATH,
): EmaGlobalConfig;

/**
 * 严格加载并校验指定 Agent 的专属 config.toml
 * (<app_data_dir>/agents/<agentId>/agent_state/config.toml)。
 * 若文件不存在或字段非法，立即抛出 [EMA Config Panic] 错误。
 */
export function loadEmaAgentConfig(
  agentId: string,
  appDataDir?: string,
): EmaAgentSpecificConfig;
```

### 2. 错误处理与 Panic 规范

| 模块 | 触发条件 | 行为规范（Panic-First） |
| :--- | :--- | :--- |
| `config.ts` | 全局或 Agent `config.toml` 缺失、TOML 语法错误、必填字段为空 | 立即抛出 `Error("[EMA Config Panic] ...")` |
| `world-server.ts` | 端口已被占用（`EADDRINUSE`）、SQLite 无法打开、未注册路由 | 立即抛出 `Error("[EMA World Server Panic] ...")` |
| `bin/ema.js world` | HTTP 连接失败、返回非 2xx 状态码、`--body` JSON 非法 | 立即抛出 `Error("[EMA World CLI Panic] ...")` 并以非零状态码退出，严禁回退到本地直连 `--db` |
| `use-ema/module.ts` | `personas_dir` 目录不存在 | 立即抛出 `Error("[EMA Personas Panic] ...")`，严禁猜测备选目录 |

---

## Drawbacks
[drawbacks]: #drawbacks

- **首次部署需显式准备 `config.toml`**：由于移除了隐式默认值与静默 fallback，宿主机首次运行前必须确保 `~/.penguin/data/ema/config.toml` 与目标 Agent 的 `config.toml` 已正确生成（可通过 `ema.js persona sync` 或初始化工具自动写入）。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **为什么不用环境变量而用分层 `config.toml`？**
  环境变量在多会话、多沙箱、守护进程与 CLI 子进程之间极易丢失或互相串扰；TOML 文件持久保存在磁盘上，具备清晰的 Schema、可读性与可审计性，且在 `workspace-write` 沙箱内外路径确定。
- **为什么不在每个 `workspace` 下存放 `.ema/` 记忆目录？**
  因为 Actor（EMA Agent）归属于 Penguin Project / Company，其生命轨迹跨越多个代码仓库与工作目录。若把记忆存在 `workspace/.ema/`，切换工作目录即导致伴侣失忆，且会污染用户的 Git 仓库。

## Prior art
[prior-art]: #prior-art

- **[RFC-0001: Ema Worlds and Actors](RFC-0001-ema-worlds-and-actors.zh.md)**：定义了 `EmaWorld` 与 `EmaActor` 核心原语及 `ema.js world` 路由契约。
- **[RFC-0003: EMA 训练元理论](RFC-0003-ema-training-meta-theory.zh.md)** 与 **[RFC-0005: 从剧本到人设与记忆的训练引擎](RFC-0005-script-to-persona-memory-training.zh.md)**：定义了离线剧本清洗、因果潜变量 `<OS>` 训练与记忆裁剪策略。
- **[RFC-0004: 内存记忆索引与内心独白](RFC-0004-in-context-memory-index-and-os.zh.md)**、**[RFC-0006: 记忆压缩算法](RFC-0006-memory-compaction.zh.md)** 与 **[RFC-0007: 梦境自省算法](RFC-0007-dreaming-and-background-consolidation.zh.md)**：定义了 `AGENTS.md` 中的热记忆索引与后台非阻塞巩固闭环。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 跨多台物理机的分布式 World 状态同步（当前架构针对单机多 Agent 共享 `~/.penguin/data/ema/worlds/` 设计，未来多节点部署时可扩展远程 World HTTP Gateway 认证）。
