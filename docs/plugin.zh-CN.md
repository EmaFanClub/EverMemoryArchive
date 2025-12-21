# 插件

插件是 Ema 的扩展机制，可以通过插件来扩展 Ema 的功能。目前支持的插件有：

- QQ

## 插件配置

目前只有一个环境变量 `EMA_PLUGINS`，用于配置插件列表，多个插件用逗号分隔。例如：

```bash
EMA_PLUGINS=qq
```

## 添加插件

插件的命名必须以`ema-plugin-`开头，例如 `ema-plugin-discord`。插件的开发可以通过以下步骤进行：

1. 创建一个插件包，例如 `ema-plugin-discord`。
2. 在 [`ema-ui/package.json`](/packages/ema-ui/package.json) 的 `peerDependencies` 中添加一行：

```jsonc
{
  "peerDependencies": {
    // PNPM 工作空间依赖
    "ema-plugin-discord": "workspace:*",
    // 或外部包依赖
    "ema-plugin-discord": "^1.0.0",
  },
}
```

3. 重启服务器。

## 插件开发

插件的根文件需要导出 `Plugin` 符号：

```ts
import type { EmaPluginProvider, Server } from "ema";
export const Plugin: EmaPluginProvider = class {
  static name = "QQ";
  constructor(private readonly server: Server) {}
  start(): Promise<void> {
    console.log("[ema-qq] started", !!this.server.chat);
    return Promise.resolve();
  }
};
```

根据编译错误的指引实现 `ema-plugin-discord` 包。
