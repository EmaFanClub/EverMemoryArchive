# 安装文档

本页补充 README 中未展开的安装选择，包含发行包类型、GitHub Actions 构建产物、可选配置、`minimal` 版本依赖安装和源码启动方式。

如果只是想尽快开始使用，推荐从 GitHub Release 下载 `portable` 版本安装包。`portable` 版本内置 Node.js、MongoDB 和 `ema-launcher` 启动器，通常不需要手动安装依赖。

## 1. 安装包版本与安装方式

### 1.1 安装包版本

| 版本 | 说明 |
| --- | --- |
| `portable` | 内置 Node.js、MongoDB 和 `ema-launcher` 启动器，下载后通常可以直接运行。推荐大多数用户使用。 |
| `minimal` | 只包含 Ema 应用和 `ema-launcher` 启动器，需要本机已有 Node.js 与 MongoDB，或配置外部 MongoDB。 |

### 1.2 安装方式

| 方式 | 说明 |
| --- | --- |
| 压缩包 | 下载 `.zip` 或 `.7z` 压缩包，解压后在包根目录运行 `ema-launcher`（Windows 为 `ema-launcher.exe`）。 |
| `installer` | 下载安装器并按提示安装。安装器文件名通常为 `*-installer.*`：Windows 为 `.exe`，macOS 为 `.command`，Linux 为 `.run`。 |

推荐组合：

- 普通用户：`portable` 版本 + 压缩包。
- 希望使用安装器：`portable` 版本 + `installer` 安装方式。
- 已经自行准备 Node.js 与 MongoDB，或希望连接外部 MongoDB：`minimal` 版本。

## 2. 从 GitHub Release 下载安装

打开 GitHub Release 页面：

https://github.com/EmaFanClub/EverMemoryArchive/releases

进入最新版本，在 `Assets` 中下载与你系统匹配的安装包。常见选择如下：

- 推荐直接运行：`ema-<platform>-portable-<revision>.zip` 或 `.7z`
- 推荐安装器：`ema-<platform>-portable-<revision>-installer.*`
- 轻量包：`ema-<platform>-minimal-<revision>.zip`、`.7z` 或 `ema-<platform>-minimal-<revision>-installer.*`

下载后：

- `.zip` / `.7z`：解压后在包根目录运行 `ema-launcher`（Windows 为 `ema-launcher.exe`）。
- `*-installer.*`：运行安装器，并按提示完成安装。
- `minimal`：先参考本文第 5 节准备 Node.js 与 MongoDB。

## 3. 从 GitHub Actions 下载安装

GitHub Actions 产物适合需要最新构建版本，或 Release 暂未发布对应版本时使用。

打开 GitHub Actions 的发行包构建页面：

https://github.com/EmaFanClub/EverMemoryArchive/actions/workflows/dist.yml

选择最新成功的 `Distribution Packages` 构建，在 `Artifacts` 中下载与你系统和用途匹配的构建产物，例如：

- Windows x64 portable 压缩包：`ema-win32-x64-portable-zip`
- Windows x64 portable 安装器：`ema-win32-x64-portable-installer`
- Apple Silicon macOS portable 安装器：`ema-darwin-arm64-portable-installer`
- Linux x64 portable 压缩包：`ema-linux-x64-portable-zip` 或 `ema-linux-x64-portable-7z`
- 轻量包：`ema-<platform>-minimal-zip`、`ema-<platform>-minimal-7z` 或 `ema-<platform>-minimal-installer`

下载后，在解压出的文件中选择合适的版本与安装方式：

- 推荐直接运行：解压 `ema-<platform>-portable-<revision>.zip` 或 `.7z` 后运行 `ema-launcher`（Windows 为 `ema-launcher.exe`）。
- 需要安装器：选择 `ema-<platform>-portable-<revision>-installer.*`。
- 需要轻量包：选择 `minimal` 版本，并先准备 Node.js 与 MongoDB。

## 4. 配置 Ema

Ema 启动后必须配置模型 API Key；Tavily 搜索引擎 API Key 和 NapCatQQ 为可选配置，可按需启用。

### 4.1 配置模型 API Key（必须）

Ema 启动后，必须至少配置一个模型 API Key。

推荐以下方式：

- Gemini 官方 API：https://aistudio.google.com/api-keys
- 429 中转站：https://429.icu/

获取 API Key 后，在 Ema 设置页面中填写即可。

### 4.2 配置 Tavily 搜索引擎 API Key（可选）

Ema 支持 Tavily 搜索引擎，用于联网搜索与信息检索。

申请 API Key：https://www.tavily.com/

然后在 Ema 设置页面中填写即可。

### 4.3 配置 NapCatQQ（可选）

如果你希望将 Ema 接入 QQ，请安装 NapCatQQ：

https://napneko.github.io/

安装完成后，根据 NapCatQQ 文档完成配置，并在 Ema 中进行连接。

## 5. 使用 minimal 版本或从源码运行

`minimal` 版本需要本机已有 Node.js 与 MongoDB，或配置外部 MongoDB。完成依赖安装后，可以在安装包内运行 `ema-launcher configure`（Windows 为 `ema-launcher.exe configure`）配置依赖路径，也可以让 `node` 和 `mongod` 直接出现在 `PATH` 中。

从源码运行 Ema 需要完成下面第 5.1 点到第 5.5 点。如果你只是使用 `minimal` 版本安装包，通常只需要完成 Node.js 与 MongoDB 的准备，然后使用安装包内的启动器。

### 5.1 安装 Node.js 和 pnpm

前往 Node.js 官方网站下载安装 Node.js（推荐 v20+）。

- Node.js 官方下载页：https://nodejs.org/en/download/

从源码运行时，还需要执行下面的命令启用 pnpm：

```bash
corepack enable pnpm
```

验证安装：

```bash
node -v
pnpm -v
```

### 5.2 下载 Ema 源码包

从 GitHub 克隆 Ema 仓库：

```bash
git clone https://github.com/EmaFanClub/EverMemoryArchive.git
cd EverMemoryArchive
```

如果你只是使用 `minimal` 版本安装包，可以跳过本步骤和后续的源码构建步骤。

### 5.3 构建 Ema 项目

安装所有依赖并构建 WebUI：

```bash
pnpm install
pnpm --filter ema-webui build
```

### 5.4 安装并启动 MongoDB

Ema 使用 MongoDB 作为数据库，需要先安装并启动 MongoDB 服务。

#### macOS（Apple Silicon）

```bash
curl -L https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.2.7.tgz -o mongodb.tgz
tar -xzf mongodb.tgz
cd mongodb-macos-arm64-8.2.7/bin
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

### 5.5 启动 WebUI

打开一个新的终端，执行：

```bash
pnpm webui -- --prod --mongo mongodb://127.0.0.1:27017/
```

启动成功后，在浏览器打开 http://localhost:3000/ 即可访问 WebUI。根据页面提示完成初始化配置。
