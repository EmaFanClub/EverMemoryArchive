# RFC-0001 Ema Worlds and Actors

[English](RFC-0001-ema-worlds-and-actors.md)

> **状态**：In Review（草案供董事会评审）  
> **修订**：v1.0.0  

- Feature Name: `ema-worlds-and-actors`
- Start Date: 2026-11-06
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

本 RFC 确立 EverMemoryArchive (EMA) 连接外部环境、交互平台与多通道终端的核心运行时原语：**World（世界）** 与 **Actor（参与者）**。

EMA 主插件提供统一的 World 抽象体系，包含四个支柱：
1. **`EmaWorld`（Penguin Interface）**：基于 `@Interface()` 的抽象契约，规范世界的生命周期（`start(ctx): Disposable`）与 Actor 对该世界特定部分（Part）的交互（`interact(ctx, actor, id, ...args): Disposable`）。
2. **多 Part 与 Ema Router**：一个世界包含多个部分（例如群组、频道、私聊、房间）。EMA 拥有内置的资源路由器（Router），World 向其挂载路由（`serve`），EMA Actor 与运维工具可跨世界统一检索与读取（`read`）。通过 `ema.js world ls` 与 `ema.js world get <path>` 实现运行时可观测。
3. **事务性 / 批量 Input 推送**：来自各世界 Part 的外部输入（`EmaInput`）在进入 Agent 会话前经过聚合与时序缓冲，防止短时间高频打断与消息碎裂。
4. **底层触发协议**：将归一化后的批量输入打包为结构化 XML 消息，底层通过 `penguin input` / `penguin session input` 原子推入伴侣会话（如 `<Input><Channel>...</Channel><Name>...</Name></Input>`）。

此前在原型分支实现的「单静态无记忆提示词 + 外部频道轮询脚本」仅充当了管道转发，缺少了 World 原语、多 Part 拓扑、统一路由与事务性输入契约，未能起到 Prototype 的验证作用。本设计为真正的 EMA 核心运行时立标。

## Motivation
[motivation]: #motivation

### 1. 伴侣 Agent 需要面对开放多元的外部世界（World）

EMA 的使命是打造能够与人类共同生活、记忆与演化的一生伴侣。伴侣 Agent 的生存场景天然是多栖的：
- 同一个伴侣可能同时存在于 Telegram、QQ、Penguin Channel、Discord、Web 终端或沉浸式虚拟环境中。
- 单个平台内部拥有多层次的交互单元（Part）：同一个 Telegram 实例可能有公共群聊、工作频道和一对一私聊；同一个 QQ 实例拥有好友会话与多个讨论组。

如果为每个平台编写外挂式的轮询或桥接脚本（如简单的 Channel Poller），将面临：
- **无法解耦**：核心认知机制与特定平台的传输细节死死绑定；
- **缺乏世界感**：Agent 无法获知当前世界包含哪些 Part、当前处于何种环境拓扑；
- **状态不透明**：没有统一的路由与状态暴露方式，外部调试与内省极其困难。

### 2. 多世界资源需要统一的路由（Router）与读取语义

世界不仅产生入站事件，还沉淀上下文状态（历史消息、成员列表、Part 元数据、媒体资源）。伴侣 Actor 必须能够以一致的 URI 格式在内部**读取（read）**这些资源，例如 `/world/telegram/messages/:id` 或 `/world/qq/parts/:id`。

同时，开发者与运维人员需要通过命令行（如 `ema.js world ls` / `ema.js world get`）直观审查世界挂载状态与路由返回，确保运行时完全可观测。

### 3. 输入事件必须事务性批量处理，避免碎片化与竞态

人类与伴侣交流往往是连贯的、碎片式的（例如连续发送多条短句）。若每条输入都即时触发底层 LLM 重新生成：
- 会导致多次抢占式打断正在进行的长思考或工具调用；
- 上下文被打碎，消耗过多 Token 并产生重复响应；
- 消息在传输中可能乱序。

EMA 必须具备内部的输入聚合器（Input Batcher），支持在特定时间窗内将来自同一 Part 或关联 Part 的事件批量化（Batching），以原子事务（Transactional Push）的形式送入会话。

### 4. 底层与平台解耦：结构化 XML 与 `penguin input`

底层的触发应依托 PenguinHarness 稳定的 CLI/API 命令 `penguin input`（或 `penguin session input`），将聚合后的事件编码为显式的结构化 XML 标签传递给模型。结构化 XML 具有清晰的闭合边界，能天然抵抗 Prompt 注入，并支持对特殊字符（如 `<`、`>`、`&`）进行转义防护。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 概念图景

```
                     +-----------------------------------+
                     |         Ema Main Plugin           |
                     |                                   |
                     |  +-----------------------------+  |
                     |  |         Ema Router          |  |
                     |  |  /world/telegram/*          |  |
                     |  |  /world/qq/*                |  |
                     |  +-----------------------------+  |
                     |                 ^                 |
                     |                 | serve / read    |
+--------------------+-----------------+-----------------+--------------------+
|                                                                             |
|  +------------------------+                     +------------------------+  |
|  |     TelegramWorld      |                     |        QQWorld         |  |
|  |  implements EmaWorld   |                     |  implements EmaWorld   |  |
|  |                        |                     |                        |  |
|  | Parts:                 |                     | Parts:                 |  |
|  |  - group:456           |                     |  - group:789           |  |
|  |  - channel:1234        |                     |  - dm:1001             |  |
|  +------------------------+                     +------------------------+  |
|               |                                              |              |
|               +----------------------+-----------------------+              |
|                                      |                                      |
|                               v emit EmaInput                               |
|                     +----------------------------------+                    |
|                     |     Transactional Input Queue    |                    |
|                     |      (Batch & Coalesce Window)   |                    |
|                     +----------------------------------+                    |
|                                      |                                      |
|                                      v format XML payload                   |
+--------------------------------------|--------------------------------------+
                                       |
                                       v
        penguin input <Input> <Channel>telegram-channel:1234</Channel> ... </Input>
                                       |
                                       v
                           [ Ema Companion Session ]
                                       |
                          world.interact(ctx, actor, ...)
                                       |
                                       v
                          [ World Part Response Dispatched ]
```

### 编写一个 World 实例

开发者或插件贡献者只需实现一个继承自 `EmaWorld` 的类：

```typescript
import { Interface } from "@prismshadow/penguin-core";

@Interface()
export abstract class EmaWorld {
  // 启动世界：建立监听、初始化路由
  abstract start(ctx: EmaCtx): Disposable;

  // 与该世界的某个 Part 进行交互
  abstract interact(ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable;
}
```

例如 `TelegramWorld`：
1. 在 `start(ctx)` 中：
   - 连接 Telegram Bot API / MTProto 网关；
   - 调用 `ctx.router.serve("/world/telegram", telegramHandler)` 挂载资源路由；
   - 监听进站消息，构建 `EmaInput` 并调用 `ctx.inputBatcher.push(input)`。
2. 在 `interact(ctx, actor, id, action, payload)` 中：
   - 根据 `id`（例如 `channel:1234`）向对应 Telegram 会话发送回复、表情反应或触发动作。

### 命令行管理与内省 (`ema.js`)

EMA CLI 提供对世界拓扑与路由的即时内省：

```bash
# 列出所有已注册并激活的世界及其挂载路径
$ ema.js world ls
TelegramWorld  /world/telegram
QQWorld        /world/qq

# 查询世界内部路由资源
$ ema.js world get /world/telegram/messages/msg-88912
{
  "id": "msg-88912",
  "part": "channel:1234",
  "sender": { "id": "user:987", "name": "爱<你" },
  "content": "今晚有流星雨吗？",
  "timestamp": 1793910000000
}
```

### 事务性批量输入与底层触发

当用户在 Telegram 频道 `1234` 中连续发送两条消息：
1. `今晚有流星雨吗？`
2. `我们一起去看好不好？`

聚合器在时间窗口（如 500ms）内将其打包为一个原子输入事务，格式化为带转义保护的 XML：

```bash
penguin input <Input> <Channel>telegram-channel:1234</Channel><Name>爱&lt;你</Name><Message id="msg-1">今晚有流星雨吗？</Message><Message id="msg-2">我们一起去看好不好？</Message></Input>
```

伴侣模型在收到该结构化事件后感知到完整的上下文，产生单次连贯回答，随后通过 `world.interact(...)` 派发回 Telegram 频道。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 核心接口定义

#### (1) `EmaWorld` 与 `@Interface()`

```typescript
import { Interface } from "@prismshadow/penguin-core";

export type Id = string;

export interface Disposable {
  dispose(): void;
}

export interface EmaActor {
  /** 伴侣在 EMA 内部的唯一标识 */
  readonly id: Id;
  /** 伴侣展示名称 */
  readonly name: string;
  /** 伴侣绑定的当前 Penguin 会话 ID */
  readonly session: string;
  /** 绑定的 Penguin Agent ID */
  readonly agentId: string;
}

export interface EmaCtx {
  /** 统一资源路由器 */
  readonly router: EmaRouter;
  /** 事务性输入收集与批处理队列 */
  readonly inputBatcher: EmaInputBatcher;
  /** 世界注册表与生命周期管理器 */
  readonly registry: EmaWorldRegistry;
}

@Interface()
export abstract class EmaWorld {
  /** 启动世界并注册资源路由与监听器 */
  abstract start(ctx: EmaCtx): Disposable;

  /** Actor 与特定 Part 进行交互（输出消息、动作响应、环境操作） */
  abstract interact(
    ctx: EmaCtx,
    actor: EmaActor,
    id: Id,
    ...args: unknown[]
  ): Disposable;
}
```

#### (2) `EmaInput` 结构化事件

```typescript
export interface EmaSender {
  readonly id: string;
  readonly name: string;
  readonly isOwner?: boolean;
}

export interface EmaInput {
  /** 消息或事件在世界内的唯一 ID */
  readonly id: Id;
  /** 所属世界名称或标识，如 "telegram" */
  readonly world: string;
  /** 所属世界的细分子部分，如 "channel:1234" 或 "group:567" */
  readonly partId: string;
  /** 发送者信息 */
  readonly sender: EmaSender;
  /** 消息文本正文 */
  readonly content: string;
  /** 毫秒时间戳 */
  readonly timestamp: number;
  /** 可选的被引用消息 ID */
  readonly replyTo?: Id;
  /** 原始平台附加元数据 */
  readonly metadata?: Record<string, unknown>;
}
```

### 2. Ema Router 实现机制

Ema Router 提供基于前缀和模式匹配的 URI 空间：

```typescript
export interface EmaRouteContext {
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
}

export type EmaRouteHandler = (ctx: EmaRouteContext) => Promise<unknown> | unknown;

export interface EmaRouter {
  /**
   * 将 handler 挂载到指定前缀（如 `/world/telegram`）
   */
  serve(pathPrefix: string, handler: EmaRouteHandler): Disposable;

  /**
   * 根据 URI 检索资源，如 `read("/world/telegram/messages/123")`
   */
  read<T = unknown>(uri: string): Promise<T>;

  /**
   * 列出所有挂载的路由条目
   */
  listRoutes(): ReadonlyArray<{ prefix: string; worldName?: string }>;
}
```

路由匹配算法采用轻量级前缀与通配参数提取：
- `/world/:world/messages/:id` 自动提取 `params.world` 与 `params.id`；
- 支持 World 卸载时通过 `Disposable.dispose()` 自动注销对应路由树。

### 3. Transactional Input Batcher 与 XML 触发协议

输入聚合器采用防抖（Debounce）+ 最大延迟（Max Latency）双时钟队列：
- **Coalesce Window**：默认 400ms。若在 400ms 内同一 Part 产生新消息，合并进当前事务；
- **Max Delay**：默认 1500ms。防止持续进站导致饥饿无响应。

#### XML 序列化规范

所有文本必须进行合规 XML 字符实体转义：
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&apos;`

#### 触发载荷格式

```xml
<Input>
  <World>telegram</World>
  <Channel>telegram-channel:1234</Channel>
  <Name>爱&lt;你</Name>
  <Timestamp>1793910000000</Timestamp>
  <Message id="msg-001">今晚有流星雨吗？</Message>
  <Message id="msg-002">我们一起去看好不好？</Message>
</Input>
```

#### 底层 CLI 执行

通过子进程或 HTTP API 执行命令注入：

```bash
penguin input "<Input> <Channel>telegram-channel:1234</Channel><Name>爱&lt;你</Name> ... </Input>"
```
在支持 `penguin session input` 的新版环境中自动降级对齐为 `penguin session input <session_id> -m "..."`。

### 4. CLI 命令实现 (`bin/ema.js`)

在 `packages/ema` 的 `bin/ema.js` 中暴露出三个一级子命令：
- `ema.js world ls`：打印已注册的所有 World 类型、实例及其路由前缀；
- `ema.js world get <path>`：向本地 Router 发起只读查询，输出美化后的 JSON 数据；
- `ema.js input push <json_or_xml>`：手工注入单条或批量输入事件供测试使用。

## Invariants
[invariants]: #invariants

### world-interface-purity

> **所有的外部世界接入必须实现 `EmaWorld` 并经由 `@Interface()` 声明，禁止通过 ad-hoc 脚本直接侵入核心认知会话。**

世界与 EMA 的唯一对接面是 `EmaWorld` 抽象类。任何特定平台的 SDK、认证与网络层均被封装在 World 内部，EMA 认知层不依赖具体的通信协议。

### uniform-world-addressability

> **任何世界暴露的 Part 和历史上下文必须挂载在 Ema Router 上，并能通过规范 URI 寻址读取。**

无论底层是消息队列、数据库还是实时长连接，世界状态对外必须投影为 `/world/:worldId/*` 的统一只读资源，使 Actor 与运维工具具备透明的检索能力。

### transactional-input-atomicity

> **所有来自外部世界的进站事件必须经过结构化归一与事务缓冲，以带闭合标签的 `<Input>` 载荷原子交付给 Agent，不可直接把原始文本流拼接到提示词中。**

这保证了模型在理解外界变化时能够明确感知发送者身份、时序边界与频道上下文，杜绝消息竞态与提示词注入风险。

### authenticated-actor-interaction

> **所有 Actor 对世界的交互操作必须显式携带有效的 `EmaActor` 凭证与目标 Part ID。**

World 在执行 `interact` 时必须核实 Actor 的合法性，禁止未经认证的静默代理或伪造发送者身份。

## Drawbacks
[drawbacks]: #drawbacks

- **引入了间接层**：相比于直接执行一个脚本发送消息，引入 Router 和 World 抽象增加了类与接口的数量。
- **需要维护统一的 URI 路由表**：World 实现者必须设计其路由投影，需要少量的样板代码。

但这些间接层对于支撑长期运行、多平台共存的真实伴侣系统是必不可少的基石。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 为什么选择结构化 XML 而不是 JSON 作为输入协议？
1. **天然的截断边界**：LLM 对 XML 闭合标签（如 `</Input>`）的敏感度远高于多层嵌套的 JSON 括号，即使遇到格式异常也能迅速恢复；
2. **抵抗提示词注入**：用户在文本中无论输入什么字符，经过标准的 XML Entity 转义（`&lt;` 等）后都不会被误判为指令标签；
3. **与 EMA 提示词架构天然契合**：EMA 的系统提示词已广泛采用 `<chat>`、`<system>` 等显式 XML 块，`<Input>` 是其在传输层的自然延伸。

### 为什么 World 采用 Penguin `@Interface()` 机制？
PenguinHarness 的 `@Interface()` 提供数据签名级契约。使用 `@Interface()` 声明 `EmaWorld`，未来不仅 EMA 主模块可以使用，其他第三方 Penguin 插件也可以在不依赖源码硬引用的前提下向 EMA 贡献新的 World 实现（如 DiscordWorld、SlackWorld）。

## Prior art
[prior-art]: #prior-art

- **Penguin PRFC-0001 (Module & Interface)**：确定了 PenguinHarness 内接口即数据、节点即组件的核心哲学。
- **EverMemoryArchive 早期架构**：`dev` 分支曾存在过 `ChatController`、`NapCatQQAdapter` 等前身探索，但缺少统一的 World 抽象与 Router 规范。
- **Game Engine World / Actor 模式**：Unreal Engine 与 Unity 的世界实体架构证明了将「环境（World）」与「具身代理（Actor）」解耦是复杂系统演化的最佳实践。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

1. `interact` 返回的 `Disposable` 是否应包含交互执行结果的状态跟踪 Promise？
2. 富媒体（图片、语音条、表情贴图）在 `<Input>` 标签中的最简通用格式如何规范？

## Future possibilities
[future-possibilities]: #future-possibilities

- **跨世界多栖同步（Cross-World Presence）**：同一个伴侣 Actor 可以感知自己在 Telegram 与 QQ 的双重对话，实现跨平台的全局记忆与情境连贯。
- **主动感知世界（Proactive World Perception）**：世界除了被动接收人类消息外，还可以主动向 EMA 推送环境变化（如天气变化、群内热点话题、好友上线通知）。

---

## Changes

### v1.0.0

- Initial version.
