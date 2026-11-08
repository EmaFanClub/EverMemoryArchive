# RFC-0001 Ema Worlds and Actors

[中文版](RFC-0001-ema-worlds-and-actors.zh.md)

> **State**: In Review (Draft for Board Review)  
> **Rev**: v1.0.0  

- Feature Name: `ema-worlds-and-actors`
- Start Date: 2026-11-06
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

This RFC establishes the core runtime primitives connecting EverMemoryArchive (EMA) companions to external environments, interaction platforms, and multi-channel terminals: **World** and **Actor**.

The EMA Main Plugin provides a unified World abstraction framework built upon four pillars:
1. **`EmaWorld` (Penguin Interface)**: An abstract interface decorated with `@Interface()` defining the lifecycle of an external realm (`start(ctx): Disposable`) and actor interactions with specific parts of that world (`interact(ctx, actor, id, ...args): Disposable`).
2. **Multi-Part Topology & Ema Router**: A world may contain multiple parts (e.g., groups, channels, direct messages, rooms). EMA maintains an internal resource router where worlds mount services (`serve`), and EMA actors and CLI tools uniformly read state (`read`). The CLI commands `ema.js world ls` and `ema.js world get <path>` provide immediate runtime observability.
3. **Transactional & Batched Input Ingestion**: Incoming external inputs (`EmaInput`) from various world parts are batched and temporally coalesced before entering the agent session, preventing fragmented turn collisions and high-frequency model interruptions.
4. **Underlying Trigger Protocol**: Coalesced inputs are serialized into structured XML payloads and atomically dispatched to the companion session via `penguin input` / `penguin session input` (e.g. `<Input><Channel>...</Channel><Name>...</Name></Input>`).

The earlier prototype's implementation of a single neutral prompt coupled to a simple channel polling script acted merely as a shallow forwarding pipe, lacking world primitives, multi-part routing, and transactional input contracts. This RFC defines the true architectural baseline for the EMA runtime.

## Motivation
[motivation]: #motivation

### 1. Companion agents inhabit diverse, multi-platform external worlds

EMA's mission is to build lifelong companions that grow, remember, and evolve with humans. A companion's natural habitat is inherently multi-homed:
- A companion may concurrently exist across Telegram, QQ, Penguin Channels, Discord, or Web clients.
- A single platform contains multi-level interaction loci (**Parts**): a Telegram instance hosts public groups, channels, and private direct messages; a QQ instance hosts friends and group chats.

Directly coupling ad-hoc polling or bridging scripts to the agent results in:
- **Tight Coupling**: Cognitive memory subsystems become entangled with transport-specific networking.
- **Absence of Environmental Context**: The agent cannot inspect what parts exist in the current world or understand its topology.
- **Opaque Runtime State**: Lacking a unified routing and resource exposure mechanism makes debugging and introspection extremely difficult.

### 2. Multi-world resources require uniform routing and read semantics

A world does not merely emit inbound events; it accumulates contextual state (message history, member rosters, part metadata). An EMA companion Actor must be able to read these resources internally using standard URIs, such as `/world/telegram/messages/:id` or `/world/qq/parts/:id`.

Similarly, human developers and operators need CLI tools (`ema.js world ls`, `ema.js world get`) to inspect active worlds and query endpoints, ensuring the runtime remains fully observable.

### 3. Inbound events must be batched transactionally to prevent fragmentation

Human conversation is frequently rapid and fragmented (e.g. sending multiple short messages consecutively). Triggering an immediate LLM invocation for each individual event causes:
- Preemptive interruptions of ongoing reasoning or active tool calls;
- Fragmented conversation turns that waste context tokens and generate redundant answers;
- Out-of-order race conditions.

EMA requires an internal input queue (Input Batcher) that collects messages from the same or related parts within a debounce window and transactionally pushes them into the session as a single atomic unit.

### 4. Platform decoupling via structured XML and `penguin input`

At the lowest level, input delivery leverages PenguinHarness's standard CLI/API invocation `penguin input` (or `penguin session input`), encoding batched events into clean, structured XML tags. XML tags provide unambiguous delimiter boundaries, resist prompt injection, and safely handle character entity escaping (`<`, `>`, `&`).

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### Conceptual Architecture

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

### Implementing a World

A plugin author implements a class extending `EmaWorld` (canonical interface contracts are defined in `packages/ema/src/interfaces.ts`):
- **Lifecycle Start**: Implements `start(ctx)` to establish external network listeners, register world routes on the router, and connect input ingestion;
- **Environmental Interaction**: Implements `interact(ctx, actor, id, ...args)` to receive actor directives and dispatch them to the targeted part.

For example, `TelegramWorld`:
1. In `start(ctx)`:
   - Establishes connection with the Telegram Bot API or MTProto client;
   - Calls `ctx.router.serve("/world/telegram", telegramHandler)` to mount resource routes;
   - Listens for inbound messages, constructs `EmaInput` instances, and enqueues them via `ctx.inputBatcher.push(input)`.
2. In `interact(ctx, actor, id, action, payload)`:
   - Targets `id` (e.g. `channel:1234`) to dispatch replies, send reactions, or execute platform actions.

### CLI Inspection and Management (`ema.js`)

The EMA CLI enables runtime introspection:

```bash
# List all registered and active worlds with their mount prefixes
$ ema.js world ls
TelegramWorld  /world/telegram
QQWorld        /world/qq

# Query resources served on world routes
$ ema.js world get /world/telegram/messages/msg-88912
{
  "id": "msg-88912",
  "part": "channel:1234",
  "sender": { "id": "user:987", "name": "爱<你" },
  "content": "Will there be a meteor shower tonight?",
  "timestamp": 1793910000000
}
```

### Transactional Input Batching and Delivery

When a user sends multiple consecutive messages in Telegram channel `1234`:
1. `Will there be a meteor shower tonight?`
2. `Shall we go watch it together?`

The batching engine coalesces both messages within a debounce window (e.g., 400ms) and outputs an atomic, XML-escaped payload:

```bash
penguin input <Input> <Channel>telegram-channel:1234</Channel><Name>爱&lt;你</Name><Message id="msg-1">Will there be a meteor shower tonight?</Message><Message id="msg-2">Shall we go watch it together?</Message></Input>
```

The companion agent ingests the structured input, generates a single cohesive response, and replies back via `world.interact(...)`.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Core Contract & Requirement Baseline

Canonical TypeScript interfaces and types are initialized in `packages/ema/src/interfaces.ts`. This section outlines the architectural **minimum required capabilities and fields**:

#### (1) `EmaWorld` (World Primitive)
- **Contract Marker**: Declared as an abstract class decorated with `@Interface()`, serving as the structural assembly handle across plugins.
- **Lifecycle Start (`start`)**: Must at least receive runtime context `EmaCtx`, establish underlying network connections/listeners, register world routes with the router, and return a `Disposable` cleanup handle.
- **Environmental Interaction (`interact`)**: Must at least receive `EmaCtx`, the operating `EmaActor`, the target part identifier (`id`) within the world, and arbitrary action payloads (replies, reactions, commands), dispatching platform operations and returning a `Disposable` interaction handle.
- **Multi-Part Topology**: Must be capable of managing and identifying multiple interaction loci (parts) within the realm (channels, groups, DMs, rooms).

#### (2) `EmaCtx` (Runtime Context)
- **Router Exposure**: Must at least provide the unified `EmaRouter` instance for mounting world routes.
- **Transactional Input Ingestion**: Must at least provide `EmaInputBatcher` for worlds to submit normalized `EmaInput` events.
- **World Registry**: Must at least expose `EmaWorldRegistry` to register world instances and discover peer worlds.

#### (3) `EmaActor` (Companion Actor Identity)
- **Identity Credentials**: Must at least provide the companion's unique actor ID, display name, bound Penguin session ID, and operating agent ID, guaranteeing provenance and preventing impersonation.

#### (4) `EmaInput` (Normalized Input Event)
- **Addressing Metadata**: Must at least provide unique event ID, originating world identifier (e.g. `telegram`, `qq`), and specific part identifier (e.g. `channel:1234`).
- **Sender Context**: Must at least provide sender external ID, display nickname, and a flag indicating whether the sender is the companion's primary owner (`isOwner`).
- **Core Payload & Timing**: Must at least provide text content and a millisecond timestamp; optionally provides referenced reply-to ID and raw platform metadata.

### 2. Ema Router Requirements

- **Route Mounting (`serve`)**: Must at least support mounting resource handlers under path prefixes (e.g. `/world/telegram`), returning a `Disposable` unmount handle.
- **Read Query (`read`)**: Must at least support querying canonical URIs (e.g. `/world/telegram/messages/:id`), extracting wildcard parameters and dispatching to registered handlers.
- **Route Enumeration (`listRoutes`)**: Must at least list all active mount prefixes for inspection and CLI observability.

Route matching supports parameterized wildcard extraction (e.g., `/world/:world/messages/:id` populates `params.world` and `params.id`). Disposing of the returned handle unmounts the corresponding subtree.

### 3. Transactional Input Batcher & XML Trigger Protocol

The input queue uses a debounce window (default 400ms) with a maximum latency cap (default 1500ms) to coalesce bursts from the same part into an atomic transaction.

#### XML Encoding and Escaping

All user-supplied content must be XML-escaped:
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&apos;`

#### Structured Payload Format

```xml
<Input>
  <World>telegram</World>
  <Channel>telegram-channel:1234</Channel>
  <Name>爱&lt;你</Name>
  <Timestamp>1793910000000</Timestamp>
  <Message id="msg-001">Will there be a meteor shower tonight?</Message>
  <Message id="msg-002">Shall we go watch it together?</Message>
</Input>
```

#### Low-Level CLI Execution

Executed via subprocess or server API:

```bash
penguin input "<Input> <Channel>telegram-channel:1234</Channel><Name>爱&lt;你</Name> ... </Input>"
```
In environments supporting `penguin session input`, the runner aliases to `penguin session input <session_id> -m "..."`.

### 4. CLI Architecture (`bin/ema.js`)

`packages/ema/bin/ema.js` exposes:
- `ema.js world ls`: Lists all active worlds and their mount prefixes;
- `ema.js world get <path>`: Queries the local router and prints formatted JSON;
- `ema.js input push <json_or_xml>`: Manually injects test events.

## Invariants
[invariants]: #invariants

### world-interface-purity

> **All external world integrations must implement `EmaWorld` declared via `@Interface()`; direct ad-hoc script injection into the core session is forbidden.**

The sole integration surface between EMA and an external environment is the `EmaWorld` abstract class. Networking, credentials, and SDK protocols are encapsulated within the world implementation.

### uniform-world-addressability

> **All parts, history, and state exposed by a world must mount to the Ema Router and remain readable via canonical URIs.**

World state must project as read-only resources under `/world/:worldId/*`, allowing uniform inspection by actors and tools.

### transactional-input-atomicity

> **Inbound events from external worlds must be normalized, transactionally batched, and delivered in structured `<Input>` XML tags rather than raw prompt concats.**

This ensures the model clearly perceives sender identity, channel context, and temporal boundaries while eliminating message race conditions.

### authenticated-actor-interaction

> **All actor interactions with a world part must carry verified `EmaActor` credentials.**

Worlds must authenticate the dispatching actor, preventing spoofed senders or unauthorized message emission.

## Drawbacks
[drawbacks]: #drawbacks

- Introduces indirection compared to executing standalone message scripts.
- Requires world authors to design URI projections for their internal state.

These layers are essential to support multi-platform lifelong companion runtimes.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Why structured XML instead of JSON?
XML tags provide unambiguous closing boundaries that LLMs recognize reliably even in incomplete streams, and standard XML character entity escaping prevents prompt injection.

### Why Penguin `@Interface()`?
`@Interface()` provides signature-level data contracts without hard runtime dependencies, allowing third-party Penguin plugins to supply world implementations (e.g. Discord, Slack, IRC) seamlessly.

## Prior art
[prior-art]: #prior-art

- **Penguin PRFC-0001 (Module & Interface)**: Foundation for interface-as-data in PenguinHarness.
- **EverMemoryArchive Legacy**: Previous explorations (`ChatController`, `NapCatQQAdapter`) in the `dev` branch.
- **Game Engine World/Actor Paradigms**: Decoupling the environment from embodied agents is an industry standard in complex simulations.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

1. Should `interact` return a Promise or an extended Disposable handle tracking delivery status?
2. What is the standard representation for rich media (images, voice, stickers) inside `<Input>` payloads?

## Future possibilities
[future-possibilities]: #future-possibilities

- **Cross-World Presence**: Single companion actor maintaining shared context and memory simultaneously across Telegram and QQ.
- **Proactive Environmental Perception**: Worlds pushing environmental updates (weather shifts, topic spikes) to trigger proactive companion thoughts.

---

## Changes

### v1.0.0

- Initial version.
