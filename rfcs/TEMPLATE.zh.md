# RFC-NNNN 标题

[English](TEMPLATE.md)

- Feature Name: `kebab-case-identifier`
- Start Date: YYYY-MM-DD
- RFC PR: [EmaFanClub/EverMemoryArchive#NNN](https://github.com/EmaFanClub/EverMemoryArchive/pull/NNN)
- Implementation PR: [EmaFanClub/EverMemoryArchive#NNN](https://github.com/EmaFanClub/EverMemoryArchive/pull/NNN)

> **状态与出处**：
> - 状态: draft / in review / landed on `main` / landed on `next`
> - 修订: v1.0.0

## Summary
[summary]: #summary

用一段话简要解释该特性或架构设计变更。

## Motivation
[motivation]: #motivation

为什么要做这个设计？它支持哪些核心用例？预期目标是什么？

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

像向另一位贡献者或用户讲解已经实现的功能一样解释本提案。通常包括：

- 引入新的具名概念。
- 主要通过示例解释特性。
- 说明用户或贡献者应当如何**理解**该特性，以及它如何影响系统使用方式。
- 适用时，描述对现有代码、工作流或用户体验的影响。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

这是 RFC 的技术细节部分。需充分阐明：

- 该设计与其他特性的交互关系。
- 该特性具体的实现方式与接口签名。
- 边界情况与典型示例分析。

本节应呼应上一节中的示例，并深入解释底层机制如何支撑这些场景。

## Invariants
[invariants]: #invariants

可选——若该设计不包含必须永久成立的核心约束，可省略本节。每个不可变约束占一项：`### <invariant-name>` 标题，引用块中的一句话声明，然后是简短说明。

```markdown
### <invariant-name>

> <用本 RFC 的词汇写成的一句话，声明始终成立的规则并引用本 RFC 定义的概念>

<描述——该属性断言了什么；解释——如何理解本 RFC 概念间的交互；原因——打破该属性将失去什么>
```

一个陈述符合以下三项检查时才属于 Invariant：**使用概念词汇**（每处引用都落在定义该概念的章节）、**至关重要**（打破它则本 RFC 的目的落空）、**超越具体实现**（替换掉实现机制的每个文件该属性依然成立）。不可变属性仅能在修订本 RFC 时具名废弃，并记录在文末 `## Changes` 中。

## Drawbacks
[drawbacks]: #drawbacks

为什么我们可能*不*应该这样做？有哪些潜在成本或缺点？

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- 为什么这个设计在所有可能的方案中是最优解？
- 曾考虑过哪些替代方案？放弃它们的理由是什么？
- 不做此设计的后果是什么？

## Prior art
[prior-art]: #prior-art

讨论与本提案相关的先验工作（无论成功或教训）：

- 类似系统中是否存在该特性？社区反馈如何？
- 论文与技术文章：是否有探讨此问题的文献或架构实践？

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 在 RFC 合并前预期通过讨论解决哪些问题？
- 在特性稳定前预期通过实现来解决哪些问题？
- 哪些相关问题被视为超出本 RFC 范围，可在未来独立解决？

## Future possibilities
[future-possibilities]: #future-possibilities

思考该提案自然的扩展与演化方向，以及它将对整个系统产生何种长期影响。也是记录与本设计相关但超出当前范围的想法的好地方。

---

## Changes

### v1.0.0

- 初始版本
