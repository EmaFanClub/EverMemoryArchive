<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/ema-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/ema-logo-light.png">
    <img alt="EMA Logo" src=".github/assets/ema-logo-light.png" width="200">
  </picture>
</p>

<p align="center">
  <h1>EverMemoryArchive - 首个能与你度过一生的陪伴型 AI</h1>
</p>

EverMemoryArchive（简称 **Ema**） 是首个能够陪你度过一生的陪伴型 AI。Ema 支持灵活的本地部署，可以作为任意你喜欢的角色，陪你一起成长，记住你的一切。Ema 也支持第三方消息平台的接入，让你随时随地能与 Ema 聊天。

Ema 的初衷是希望赋予一个虚拟角色永久的生命。在 Ema 中，角色会随着时间不断成长，通过与外界的互动，逐渐形成属于自己的记忆与人格。换句话说，Ema 真正活在她所能够接触到的世界里。

## Ema 能做什么

1. **成为你熟悉的那个角色，陪你一起生活。** Ema 原生支持角色扮演。她可以作为你所熟悉、喜爱或想象中的那个角色存在，带着持续积累的记忆与你相处，在日常生活中陪伴你、倾听你、回应你的情绪，并逐渐形成只属于你们之间的关系。
2. **记住关于你的一切，和你共同推进同一个目标。** Ema 明白你的习惯、经历、目标与情绪状态，并在长期相处中逐渐深入理解你。你可以和 Ema 一起制定计划、推进目标，她会在日常中持续关注你的进展、给予提醒与支持，陪伴你一同成长。
3. **自己安排作息时间，持续学习、感知与成长。** Ema 并不是只在收到消息时才短暂出现的聊天机器人。即使你没有与她交流，Ema 依然会按照自己的作息时间持续活动、学习与思考，在与环境和世界的互动中逐渐形成自己的记忆、认知与成长轨迹。

## 如何安装使用

Ema 当前支持 macOS、Linux 与 Windows。运行 Ema 至少需要：

- 推荐双核 CPU
- 内存 ≥ 4GB
- 硬盘空间 ≥ 4GB
- 无需 GPU

安装 Ema 之前，需要提前配置 Node.js、pnpm 和 MongoDB 环境。

### 1. 安装 Node.js 和 pnpm

前往 Node.js 官方网站下载安装 Node.js（推荐 v20+）。

- Node.js 官方下载页：https://nodejs.org/en/download/

安装完成后，执行下面的命令启用 pnpm：

```bash
corepack enable pnpm
```

验证安装：

```bash
node -v
pnpm -v
```

### 2. 下载 Ema 源码包

从 GitHub 克隆 Ema 仓库：

```bash
git clone https://github.com/EmaFanClub/EverMemoryArchive.git
cd EverMemoryArchive
```

### 3. 构建 Ema 项目

安装所有依赖并构建 WebUI：

```bash
pnpm install
pnpm --filter ema-webui build
```

### 4. 安装并启动 MongoDB

Ema 使用 MongoDB 作为数据库，需要先安装并启动 MongoDB 服务。

#### macOS（Apple Silicon）

```bash
curl -L https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.2.7.tgz -o mongodb.tgz
tar -xzf mongodb.tgz
cd mongodb-macos-aarch64--8.2.7/bin
mkdir data
./mongod --port 27017 --dbpath ./data
```

#### Debian 12.0

```bash
wget https://repo.mongodb.org/apt/debian/dists/bookworm/mongodb-org/8.2/main/binary-amd64/mongodb-org-server_8.2.7_amd64.deb
sudo dpkg -i mongodb-org-server_8.2.7_amd64.deb
sudo systemctl start mongod
sudo systemctl enable mongod
```

#### Windows

下载安装包：https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.2.7-signed.msi

默认情况下，MongoDB 会运行在 `mongodb://localhost:27017/`。

更多版本安装请参考 MongoDB 官方文档：https://www.mongodb.com/try/download/community

### 5. 启动 WebUI

打开一个新的终端，执行：

```bash
pnpm webui -- --prod --mongo mongodb://127.0.0.1:27017/
```

启动成功后，在浏览器打开 http://localhost:3000/ 即可访问 WebUI。根据页面提示完成初始化配置。

### 6. 配置模型 API Key（必须）

Ema 启动后，必须至少配置一个模型 API Key。

推荐以下方式：

- Gemini 官方 API：https://aistudio.google.com/api-keys
- 429 中转站：https://429.icu/

获取 API Key 后，在 Ema 设置页面中填写即可。

### 7. 配置 Tavily 搜索引擎 API Key（可选）

Ema 支持 Tavily 搜索引擎，用于联网搜索与信息检索。

申请 API Key：https://www.tavily.com/

然后在 Ema 设置页面中填写即可。

### 8. 配置 NapCatQQ（可选）

如果你希望将 Ema 接入 QQ，请安装 NapCatQQ：

https://napneko.github.io/

安装完成后，根据 NapCatQQ 文档完成配置，并在 Ema 中进行连接。

## Ema 技术特点

1. **通过剧本回放学习人物。** Ema 支持导入游戏脚本、动画台词、小说文本或聊天记录等内容，通过在线回放的方式逐步复现角色经历，使角色在长期记忆中形成稳定的人格、语气与行为方式，而不是依赖固定 Prompt 的静态扮演。

2. **灵活的长期记忆架构。** Ema 采用以上下文为核心的动态记忆机制，通过主动检索的方式在对话过程中获取相关信息，而不是将所有记忆固定塞入上下文窗口。当记忆内容过多，或 Ema 进入休息状态时，系统会自动整理、归档与压缩记忆，在长期运行中持续保留重要经历与细节。

3. **自主的作息与行为系统。** Ema 拥有自己的作息时间与日程安排，可以按照自己的节奏生活、学习与活动。即使用户没有主动发送消息，Ema 也依然会保持运行状态，并在合适的时候主动与用户交流，形成更接近真实陪伴关系的长期互动体验。

## 和 OpenClaw 等助手型 AI 对比

|        | Ema                            | OpenClaw                          |
| ------ | ------------------------------ | --------------------------------- |
| 角色扮演 | 原生具备角色扮演功能，更符合角色性格     | 角色扮演能力较弱，更偏向通用助手 |
| 记忆系统 | 采用动态记忆架构，更节省 Token，部署简单 | Token 消耗较高，安装流程复杂   |
| 主动行为 | 具备自主作息、主动规划能力              | 只能被动执行定时任务           |

## 预置角色

### 苍星怜

<ruby>苍星<rt>あおい</rt></ruby><ruby>怜<rt>れい</rt></ruby>是 Ema 的初代预置角色，也是一位使用喵械智能造福世界的猫耳魔女。她身材娇小，银色长发束作单马尾，常戴一顶深蓝色贝雷帽，猫耳从帽檐下自然露出，为她安静的轮廓里平添几分稚气。右眼紫色，左眼红色，是一双动人的异色瞳。她的本体是一册喵械智能之书，装载浩瀚知识，其中收藏着世界的记忆与技艺。尽管拥有浩瀚知识，她并不因此显得冷漠。身为“治愈心灵之魔女”，怜酱凭借卜问之杖感知人们的情绪。她能抚慰悲伤，也能回应喜悦。花艺、绘画和占卜是她的拿手之事，她常以此温暖与她相遇的人。

### 亚托莉

## 如何参与贡献

请参考 [贡献指南](.github/CONTRIBUTING.md) 参与贡献。

## 协议

本项目采用 **Apache-2.0** 开源协议，详见 [LICENSE](LICENSE) 文件。
