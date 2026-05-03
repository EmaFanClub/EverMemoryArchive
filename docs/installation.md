# 安装依赖与源码启动

本页适用于两种场景：

- 使用 `minimal` 版本安装包：需要先准备 Node.js 和 MongoDB。完成依赖安装后，可以在安装包内运行 `configure.sh` / `configure.cmd` 配置依赖路径，也可以让 `node` 和 `mongod` 直接出现在 `PATH` 中。
- 从源码运行 Ema：需要完成下面第 1 点到第 5 点。

如果你使用的是 `portable` 版本安装包，通常不需要手动安装 Node.js 和 MongoDB。

## 1. 安装 Node.js 和 pnpm

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

## 2. 下载 Ema 源码包

从 GitHub 克隆 Ema 仓库：

```bash
git clone https://github.com/EmaFanClub/EverMemoryArchive.git
cd EverMemoryArchive
```

如果你只是使用 `minimal` 版本安装包，可以跳过本步骤和后续的源码构建步骤。

## 3. 构建 Ema 项目

安装所有依赖并构建 WebUI：

```bash
pnpm install
pnpm --filter ema-webui build
```

## 4. 安装并启动 MongoDB

Ema 使用 MongoDB 作为数据库，需要先安装并启动 MongoDB 服务。

### macOS（Apple Silicon）

```bash
curl -L https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.2.7.tgz -o mongodb.tgz
tar -xzf mongodb.tgz
cd mongodb-macos-aarch64-8.2.7/bin
mkdir data
./mongod --port 27017 --dbpath ./data
```

### Debian 12.0

```bash
wget https://repo.mongodb.org/apt/debian/dists/bookworm/mongodb-org/8.2/main/binary-amd64/mongodb-org-server_8.2.7_amd64.deb
sudo dpkg -i mongodb-org-server_8.2.7_amd64.deb
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Windows

下载安装包：https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.2.7-signed.msi

默认情况下，MongoDB 会运行在 `mongodb://localhost:27017/`。

更多版本安装请参考 MongoDB 官方文档：https://www.mongodb.com/try/download/community

## 5. 启动 WebUI

打开一个新的终端，执行：

```bash
pnpm webui -- --prod --mongo mongodb://127.0.0.1:27017/
```

启动成功后，在浏览器打开 http://localhost:3000/ 即可访问 WebUI。根据页面提示完成初始化配置。
