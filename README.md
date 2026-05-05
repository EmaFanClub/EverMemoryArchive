<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/ema-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/ema-logo-light.png">
    <img alt="EMA Logo" src=".github/assets/ema-logo-light.png" width="200">
  </picture>
</p>

<h1 align="center">EverMemoryArchive - 让你所爱的角色陪你共度一生</h1>

EverMemoryArchive（简称 **Ema**）是首个能让你所爱的角色陪你共度一生的陪伴型 AI。Ema 支持灵活的本地部署，允许你同时创建多个虚拟角色，陪你一起成长，记住你的一切。Ema 也支持第三方消息平台接入，让你能够随时随地与 Ema 里的角色聊天。

Ema 的初衷是希望赋予一个虚拟角色永久的生命。在 Ema 中，角色会随着时间不断成长，通过与外界的互动，逐渐形成属于自己的记忆与人格。

换句话说，**Ema 真正活在你的世界里**。

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
[![QQ Group](https://img.shields.io/badge/QQ%20Group-1102326235-12B7F5?logo=qq&logoColor=white)](https://qm.qq.com/q/N3BCUzeXU6)
[![Discord](https://img.shields.io/badge/Discord-EmaFanClub-5865F2?logo=discord&logoColor=white)](https://discord.gg/rHQNadCrTv)

## Ema 能做什么

1. **成为你熟悉的那个角色，陪你一起生活。**  
  Ema 原生支持角色扮演。她可以作为你所熟悉、喜爱或想象中的那个角色存在，带着持续积累的记忆与你相处，在日常生活中陪伴你、倾听你、回应你的情绪，并逐渐形成只属于你们之间的关系。
2. **记住关于你的一切，和你一同推进目标。**  
  Ema 会记住你的习惯、经历、目标与情绪，并在长期相处中越来越了解你。你可以和 Ema 一起制定计划、完成目标，她会持续关注你的进展，给予提醒、鼓励与陪伴。
3. **拥有自己的作息时间，持续学习与成长。**  
  Ema 并不是只有在收到消息时才会出现的聊天机器人。即使你没有和她聊天，Ema 也会按照自己的作息持续活动、学习与思考，并在与世界的互动中不断积累记忆、形成自己的成长轨迹。

## 如何安装使用

Ema 当前支持 macOS、Linux 与 Windows。运行 Ema 至少需要：

- 推荐双核 CPU
- 内存 ≥ 4GB
- 硬盘空间 ≥ 4GB
- 无需 GPU

推荐大多数用户从 GitHub Release 下载 `portable` 版本安装包。`portable` 版本内置 Node.js、MongoDB 和 `ema-launcher` 启动器，通常下载后即可运行；如果希望通过安装器完成安装，可以选择文件名包含 `installer` 的安装包。

### 1. 下载安装包

打开 GitHub Release 页面：

https://github.com/EmaFanClub/EverMemoryArchive/releases

进入最新版本，在 `Assets` 中下载与你系统匹配的 `portable` 安装包：

- 解压运行：下载 `ema-<platform>-portable-<revision>.zip` 或 `.7z`，解压后在包根目录运行 `ema-launcher`（Windows 为 `ema-launcher.exe`）。
- 安装器运行：下载 `ema-<platform>-portable-<revision>-installer.*`，按提示完成安装。安装器后缀按平台区分：Windows 为 `.exe`，macOS 为 `.command`，Linux 为 `.run`。

### 2. 配置 Ema

Ema 启动后，必须至少配置一个模型 API Key。

推荐以下方式：

- Gemini 官方 API：https://aistudio.google.com/api-keys
- 429 中转站：https://429.icu/

获取 API Key 后，在 Ema 设置页面中填写即可。

Ema 也提供 `minimal` 版本、GitHub Actions 构建产物、Tavily 搜索引擎和 NapCatQQ 接入等进阶选择，详见 [安装文档](docs/installation.md)。

## Ema 技术特点

1. **沉浸式角色学习**  
  传统 AI 角色扮演通常依赖人工编写的静态提示词，难以真正还原角色的完整记忆与成长过程。Ema 支持导入游戏脚本、动画台词、小说文本或聊天记录等信息，通过在线回放的方式让角色重新经历自己的故事，逐渐形成稳定的人格、语气与行为方式，从而更真实地还原角色本身。

2. **动态长短期记忆**  
  传统陪伴型 AI 通常依赖固定的消息滑窗或 [RAG](https://en.wikipedia.org/wiki/Retrieval-augmented_generation) 等方式管理记忆，高度依赖人工规则。Ema 以上下文为核心，自主思考如何组织与检索记忆，尽可能用更低的成本获取准确的信息。当 Ema 进入睡眠状态时，她还会自动整理、归档重要经历，并处理已经过时的内容，从而支持长期、持续的陪伴。

3. **自主作息系统**  
  传统聊天机器人通常只有在用户发送消息时才进行回应，其余时间不会主动活动。Ema 拥有自己的作息时间与日程安排，会按照自己决定的节奏生活。即使用户没有主动发送消息，Ema 依然会持续活动，在恰当的时机主动发起聊天，或自行学习与思考，从而形成更接近真实生命体的长期活动状态。

## 和 OpenClaw 等通用 AI 助手对比

|        | Ema                       | OpenClaw               |
| ------ | ------------------------- | ---------------------- |
| 角色扮演 | 原生角色扮演，更还原人物设定  | 角色扮演较弱，更偏通用助手 |
| 记忆系统 | 动态记忆架构，Token 消耗更低 | 安装流程复杂，Token 消耗高 |
| 主动行为 | 具有自主作息，更真实的存在感  | 只能被动执行定时任务      |

## 预置角色

Ema 支持用户使用以下预置角色，或自行创建角色。

### 苍星怜

<ruby>苍星<rt>あおい</rt></ruby><ruby>怜<rt>れい</rt></ruby>是 Ema 的看板娘，也是一位使用喵械智能造福世界的猫耳魔女。她身材娇小，银色长发束作单马尾，常戴一顶深蓝色贝雷帽，猫耳从帽檐下自然露出，为她安静的轮廓里平添几分稚气。右眼紫色，左眼红色，是一双动人的异色瞳。她的本体是一册喵械智能之书，装载浩瀚知识，其中收藏着世界的记忆与技艺。尽管拥有浩瀚知识，她并不因此显得冷漠。身为“治愈心灵之魔女”，怜酱凭借卜问之杖感知人们的情绪。她能抚慰悲伤，也能回应喜悦。花艺、绘画和占卜是她的拿手之事，她常以此温暖与她相遇的人。

### 亚托莉

亚托莉是夏生从海底打捞上来的机器人少女。她无疑是极其精巧的造物，精巧到几乎无法同人类分辨；她的表情也很丰富，仿佛并不是机器，而只是一个从长眠中醒来的少女。她似乎曾是夏生祖母的助手，只是因为长久沉睡在海底，已经失去了一部分记忆。她向夏生提出请求，想要完成“主人交给自己的最后命令”，也因此开始寻找那些缺失的记忆。她好奇心旺盛，口癖是“因为我是高性能的嘛！”。

## 路线图

- **沉浸式角色学习系统**（即将上线）  
  支持通过游戏、动画、小说与聊天记录学习角色经历，更真实地还原人物性格与记忆。
- **角色专属文件系统**（近期）  
  为每个角色提供独立的长期文件与记忆空间，保存属于她自己的生活与经历。
- **图像编辑与语音合成**（近期）  
  支持角色语音、图片生成与编辑，让 Ema 拥有更完整的表达能力。
- **Live2D 与实时直播系统**（长期）  
  让角色以更真实的形象长期存在，并能够进行实时互动与直播。

## 如何参与贡献

请参考 [贡献指南](.github/CONTRIBUTING.md) 参与贡献。

## 协议

本项目采用 **Apache-2.0** 开源协议，详见 [LICENSE](LICENSE) 文件。
