import type { EmaPluginProvider, Server } from "ema";
import { NCWebsocket } from "node-napcat-ts";

const napcat = new NCWebsocket(
  {
    protocol: "ws",
    host: "localhost",
    port: 6099,
    accessToken: process.env.NAPCAT_ACCESS_TOKEN,
    // 是否需要在触发 socket.error 时抛出错误, 默认关闭
    throwPromise: true,
    // ↓ 自动重连(可选)
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000,
    },
    // ↓ 是否开启 DEBUG 模式
  },
  true,
);

await napcat.send_group_msg({
  group_id: 1044916258,
  message: [
    {
      type: "text",
      data: {
        text: "全局消息：喵",
      },
    },
  ],
});

export const Plugin: EmaPluginProvider = class {
  static name = "QQ";
  constructor(private readonly server: Server) {}
  start(): Promise<void> {
    console.log("[ema-qq] started", !!this.server.chat);

    napcat.on("message.group", (message) => {
      console.log("[ema-qq] group message", message);
    });

    return Promise.resolve();
  }
};
