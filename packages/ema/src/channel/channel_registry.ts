import type { Server } from "../server";
import type { Channel, ChannelAdapterFactory } from "./base";
import { WebsocketChannelClient } from "./channel_client";
import { NapCatQQAdapter } from "./napcatqq_adapter";
import { WebChannel } from "./web_channel";

/**
 * Manages runtime channel instances for all actors.
 */
export class ChannelRegistry {
  readonly webChannel = new WebChannel();

  private readonly channels = new Map<number, Map<string, Channel>>();
  private readonly channelStartInFlight = new Map<number, Promise<void>>();

  constructor(private readonly server: Server) {}

  /**
   * Lists supported adapter names.
   * @returns Supported adapter names.
   */
  listAdapterNames(): string[] {
    return ["qq"];
  }

  /**
   * Gets one adapter factory by channel name.
   * @param channelName - Channel name.
   * @returns Adapter factory, or null when unsupported.
   */
  getAdapterFactory(channelName: string): ChannelAdapterFactory | null {
    if (channelName === "qq") {
      return (call) => new NapCatQQAdapter(call);
    }
    return null;
  }

  /**
   * Gets one runtime channel instance for one actor.
   * @param actorId - Actor identifier.
   * @param channelName - Channel name.
   * @returns Runtime channel instance, or null when missing.
   */
  getChannel(actorId: number, channelName: string): Channel | null {
    if (channelName === this.webChannel.name) {
      return this.webChannel;
    }
    return this.channels.get(actorId)?.get(channelName) ?? null;
  }

  /**
   * Registers one actor-scoped runtime channel.
   * @param actorId - Actor identifier.
   * @param channel - Runtime channel instance.
   */
  registerChannel(actorId: number, channel: Channel): void {
    if (channel.name === this.webChannel.name) {
      return;
    }
    let actorChannels = this.channels.get(actorId);
    if (!actorChannels) {
      actorChannels = new Map<string, Channel>();
      this.channels.set(actorId, actorChannels);
    }
    actorChannels.set(channel.name, channel);
  }

  /**
   * Starts runtime channels for one actor when needed.
   * @param actorId - Actor identifier.
   */
  startChannels(actorId: number): void {
    const actorChannels = this.channels.get(actorId);
    if (!actorChannels) {
      return;
    }
    for (const channel of actorChannels.values()) {
      if (
        channel instanceof WebsocketChannelClient &&
        channel.isEnabled() &&
        channel.getStatus() === "disconnected"
      ) {
        channel.start();
      }
    }
  }

  async removeActorChannels(actorId: number): Promise<void> {
    const actorChannels = this.channels.get(actorId);
    if (!actorChannels) {
      return;
    }
    await Promise.all(
      Array.from(actorChannels.values()).map(async (channel) => {
        if (channel instanceof WebsocketChannelClient) {
          await channel.close();
        }
      }),
    );
    this.channels.delete(actorId);
  }

  async refreshActorChannels(actorId: number): Promise<void> {
    await this.removeActorChannels(actorId);
    if (!this.server.actorRegistry?.get(actorId)) {
      return;
    }
    await this.ensureStarted(actorId);
  }

  getActorChannelStatus(
    actorId: number,
    channelName: string,
  ): "connecting" | "connected" | "disconnected" {
    const channel = this.getChannel(actorId, channelName);
    if (!(channel instanceof WebsocketChannelClient)) {
      return "disconnected";
    }
    const status = channel.getStatus();
    if (status === "connected") {
      return "connected";
    }
    if (status === "connecting") {
      return "connecting";
    }
    return "disconnected";
  }

  async restartActorChannel(
    actorId: number,
    channelName: string,
  ): Promise<void> {
    await this.removeActorChannel(actorId, channelName);
    if (!this.server.actorRegistry?.get(actorId)) {
      return;
    }
    await this.ensureChannelStarted(actorId, channelName);
  }

  /**
   * Ensures runtime channels for one actor are created and started.
   * @param actorId - Actor identifier.
   */
  async ensureStarted(actorId: number): Promise<void> {
    let inFlight = this.channelStartInFlight.get(actorId);
    if (!inFlight) {
      inFlight = (async () => {
        for (const channelName of this.listAdapterNames()) {
          if (this.getChannel(actorId, channelName)) {
            continue;
          }
          const channel = await this.createActorChannel(actorId, channelName);
          if (!channel) {
            continue;
          }
          this.registerChannel(actorId, channel);
        }
        this.startChannels(actorId);
      })();
      this.channelStartInFlight.set(actorId, inFlight);
    }
    try {
      await inFlight;
    } finally {
      if (this.channelStartInFlight.get(actorId) === inFlight) {
        this.channelStartInFlight.delete(actorId);
      }
    }
  }

  private async ensureChannelStarted(
    actorId: number,
    channelName: string,
  ): Promise<void> {
    if (this.getChannel(actorId, channelName)) {
      this.startChannels(actorId);
      return;
    }
    const channel = await this.createActorChannel(actorId, channelName);
    if (!channel) {
      return;
    }
    this.registerChannel(actorId, channel);
    this.startChannels(actorId);
  }

  private async removeActorChannel(
    actorId: number,
    channelName: string,
  ): Promise<void> {
    const channel = this.getChannel(actorId, channelName);
    if (channel instanceof WebsocketChannelClient) {
      await channel.close();
    }
    const actorChannels = this.channels.get(actorId);
    actorChannels?.delete(channelName);
    if (actorChannels?.size === 0) {
      this.channels.delete(actorId);
    }
  }

  private async createActorChannel(
    actorId: number,
    channelName: string,
  ): Promise<Channel | null> {
    const adapterFactory = this.getAdapterFactory(channelName);
    if (!adapterFactory) {
      return null;
    }

    if (channelName === "qq") {
      const config = await this.server.dbService.getActorChannelConfig(actorId);
      if (!config.qq.enabled) {
        return null;
      }
      if (!config.qq.wsUrl.trim() || !config.qq.accessToken.trim()) {
        return null;
      }
      const channel = await WebsocketChannelClient.create(
        channelName,
        actorId,
        config.qq.wsUrl,
        this.server,
        adapterFactory,
        config.qq.accessToken,
      );
      channel.onStatusChange(() => {
        this.server.controller.channel
          .publishQqStatus(actorId)
          .catch((error) => {
            this.server.logger.warn("Failed to publish QQ channel status", {
              actorId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
      return channel;
    }

    return null;
  }
}
