import type { AgentEventContent, EmaPluginProvider, Server } from "ema";
import { NCWebsocket, type GroupMessage } from "node-napcat-ts";
import { execSync } from "child_process";

const gitRev = getGitRev();
const gitRemote = getGitRemote();

const napcat = new NCWebsocket(
  {
    protocol: "ws",
    host: "172.19.0.2",
    port: 6097,
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

export const Plugin: EmaPluginProvider = class {
  static name = "QQ";
  constructor(private readonly server: Server) {}
  async start(): Promise<void> {
    const replyPat = process.env.NAPCAT_REPLY_PATTERN;
    if (!replyPat) {
      throw new Error("NAPCAT_REPLY_PATTERN is not set");
    }

    await napcat.connect();

    const actor = await this.server.getActor(1, 1);

    interface GroupMessageTask {
      message: GroupMessage;
    }

    let taskId = 0;
    const tasks: Record<number, GroupMessageTask> = {};
    const messageCache = new Map<number, string>();

    actor.subscribe((response) => {
      console.log("[ema-qq] actor response", response);
      for (const event of response.events) {
        console.log("[ema-qq] actor event", event);
        if (event.type === "runFinished") {
          const runFinishedEvent =
            event.content as AgentEventContent<"runFinished">;
          console.log("[ema-qq] actor run finished", runFinishedEvent);
          if (runFinishedEvent.ok) {
            const task = tasks[runFinishedEvent.metadata.taskId];
            if (!task) {
              console.error(
                "[ema-qq] task not found",
                runFinishedEvent.metadata.taskId,
              );
              continue;
            }
            const message = task.message;
            const msg = runFinishedEvent.msg
              .trim()
              .replaceAll(
                gitRev,
                `[${gitRev}]( ${gitRemote}/commit/${gitRev} )`,
              );
            message.quick_action(
              [
                {
                  type: "text",
                  data: {
                    text: ` ${msg}`,
                  },
                },
              ],
              true,
            );
          }
        }
      }
    });

    napcat.on("message.group", async (message) => {
      //  { type: 'reply', data: [Object] },
      console.log("[ema-qq] group message");
      console.log("[ema-qq] group message", message);

      if (!message.raw_message.includes(replyPat)) {
        console.log("message ignored");
        return;
      }
      let replyContext = "";
      const reply = message.message.find((m) => m.type === "reply");
      if (reply) {
        const replyId = Number.parseInt(reply?.data.id);
        if (replyId && !Number.isNaN(replyId)) {
          const cached = messageCache.get(replyId);
          if (cached) {
            replyContext = cached;
          } else {
            const msg = await napcat.get_msg({ message_id: replyId });
            if (msg) {
              replyContext = msg.raw_message;
              messageCache.set(replyId, replyContext);
            }
          }
        }
      }
      messageCache.set(message.message_id, message.raw_message);

      const id = taskId++;
      tasks[id] = { message };

      let contentList = [];
      if (replyContext) {
        contentList.push(`注意：这则消息是在回复：<Reply>`);
        contentList.push(replyContext);
        contentList.push(`</Reply>`);
      }
      contentList.push(message.raw_message);
      // current time
      contentList.push(`当前时间：<Time>${new Date().toLocaleString()}</Time>`);
      contentList.push(`GitRev（分支）：<Rev>${gitRev}</Rev>`);

      const content = contentList.join("\n");

      actor.work({
        metadata: { taskId: id },
        inputs: [{ kind: "text", content }],
      });
    });

    return Promise.resolve();
  }
};

function getGitRev(): string {
  // git commit hash
  return execSync("git rev-parse HEAD").toString().trim();
}

function getGitRemote(): string {
  return execSync("git remote get-url origin").toString().trim();
}
