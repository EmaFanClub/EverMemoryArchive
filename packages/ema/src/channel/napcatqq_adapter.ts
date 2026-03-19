import type { ActorChatResponse } from "../actor";
import type { InputContent, MIME } from "../schema";
import type {
  ChannelAdapter,
  ChannelAPICall,
  ChannelAPICaller,
  ChannelChatEvent,
  ChannelDecodeResult,
  ChannelResponse,
  MessageReplyRef,
  SpeakerInformation,
} from "./base";
import {
  buildSession,
  formatMentionText,
  parseReplyRef,
  resolveSession,
  resolveSupportedMediaMimeType,
  shouldAcceptMedia,
} from "./utils";

interface NapCatQQSender {
  user_id?: number | string;
  nickname?: string;
  card?: string;
}

interface NapCatQQSegment {
  type?: string;
  data?: Record<string, unknown>;
}

interface NapCatQQMessageEvent {
  time?: number | string;
  post_type?: string;
  message_type?: "private" | "group";
  sub_type?: string;
  message_id?: number | string;
  self_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  raw_message?: string;
  message?: string | NapCatQQSegment[];
  sender?: NapCatQQSender;
}

const MEDIA_FETCH_TIMEOUT_MS = 30_000;
const FILE_URL_REQUEST_TIMEOUT_MS = 60_000;

export class NapCatQQAdapter implements ChannelAdapter<unknown, string> {
  readonly name = "qq";

  constructor(readonly call: ChannelAPICaller = async () => null) {}

  async decode(raw: unknown): Promise<ChannelDecodeResult> {
    const payload = this.parseIncoming(raw);
    if (!payload) {
      return { kind: "ignore" };
    }

    if (typeof payload.echo === "string") {
      return {
        kind: "response",
        requestId: payload.echo,
        response: this.buildChannelResponse(payload),
      };
    }

    const event = await this.decodeChatEvent(payload as NapCatQQMessageEvent);
    if (!event) {
      return { kind: "ignore" };
    }

    return {
      kind: "events",
      events: [event],
    };
  }

  async encode(
    apiCall: ChannelAPICall,
    requestId: string,
  ): Promise<string | null> {
    return JSON.stringify({
      action: apiCall.method,
      params: apiCall.params ?? {},
      echo: requestId,
    });
  }

  async chatToAPICall(
    response: ActorChatResponse,
  ): Promise<ChannelAPICall | null> {
    const sessionInfo = resolveSession(response.session);
    if (!sessionInfo || sessionInfo.channel !== this.name) {
      return null;
    }

    const message = this.buildSegments(response);
    if (message.length === 0) {
      return null;
    }

    if (sessionInfo.type === "group") {
      return {
        method: "send_group_msg",
        params: {
          group_id: sessionInfo.uid,
          message,
        },
      };
    }

    return {
      method: "send_private_msg",
      params: {
        user_id: sessionInfo.uid,
        message,
      },
    };
  }

  resolveChannelMessageId(
    response: ChannelResponse,
    apiCall: ChannelAPICall,
  ): string | null {
    if (
      apiCall.method !== "send_private_msg" &&
      apiCall.method !== "send_group_msg"
    ) {
      return null;
    }
    if (!response.ok || !response.data || typeof response.data !== "object") {
      return null;
    }
    if (
      !("message_id" in response.data) ||
      (typeof response.data.message_id !== "string" &&
        typeof response.data.message_id !== "number")
    ) {
      return null;
    }
    return String(response.data.message_id);
  }

  private parseIncoming(raw: unknown): Record<string, unknown> | null {
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === "object") {
      return raw as Record<string, unknown>;
    }
    return null;
  }

  private buildChannelResponse(
    payload: Record<string, unknown>,
  ): ChannelResponse {
    const hasStatus = typeof payload.status === "string";
    const hasRetcode = typeof payload.retcode === "number";
    const ok =
      (!hasStatus || payload.status === "ok") &&
      (!hasRetcode || payload.retcode === 0);

    return {
      ok,
      ...(payload.data !== undefined ? { data: payload.data } : {}),
      ...(!ok
        ? {
            error:
              payload.data ?? payload.wording ?? payload.message ?? payload,
          }
        : {}),
    };
  }

  private async decodeChatEvent(
    payload: NapCatQQMessageEvent,
  ): Promise<ChannelChatEvent | null> {
    if (payload.post_type !== "message") {
      return null;
    }
    if (!this.isSupportedMessageEvent(payload)) {
      return null;
    }

    const speaker = this.buildSpeaker(payload);
    if (!speaker) {
      return null;
    }
    if (
      typeof payload.message_id === "undefined" ||
      payload.message_id === null
    ) {
      return null;
    }

    const decoded = await this.decodeInputs(payload);
    if (decoded.inputs.length === 0) {
      return null;
    }

    return {
      kind: "chat",
      channel: this.name,
      session: speaker.session,
      channelMessageId: String(payload.message_id),
      speaker,
      inputs: decoded.inputs,
      ...(decoded.replyTo ? { replyTo: decoded.replyTo } : {}),
      time: this.resolveEventTime(payload.time),
    };
  }

  private buildSegments(response: ActorChatResponse): NapCatQQSegment[] {
    const segments: NapCatQQSegment[] = [];
    const replyTo = response.ema_reply.reply_to
      ? parseReplyRef(response.ema_reply.reply_to)
      : null;
    if (
      replyTo &&
      replyTo.kind === "channel" &&
      replyTo.channel === this.name
    ) {
      segments.push({
        type: "reply",
        data: {
          id: replyTo.channelMessageId,
        },
      });
    }
    if (response.ema_reply.mention_uids) {
      for (const uid of response.ema_reply.mention_uids) {
        segments.push({
          type: "at",
          data: {
            qq: uid,
          },
        });
      }
    }
    if (response.ema_reply.contents.length > 0) {
      segments.push({
        type: "text",
        data: {
          text: response.ema_reply.contents,
        },
      });
    }
    return segments;
  }

  private isSupportedMessageEvent(payload: NapCatQQMessageEvent): boolean {
    if (payload.message_type === "private") {
      return payload.sub_type === "friend";
    }
    if (payload.message_type === "group") {
      return payload.sub_type === "normal";
    }
    return false;
  }

  private async decodeInputs(payload: NapCatQQMessageEvent): Promise<{
    inputs: InputContent[];
    replyTo?: MessageReplyRef;
  }> {
    if (typeof payload.message === "string") {
      if (payload.message.includes("[CQ:")) {
        return { inputs: [] };
      }
      return {
        inputs: payload.message.trim()
          ? [{ type: "text", text: payload.message.trim() }]
          : [],
      };
    }

    const inputs: InputContent[] = [];
    let replyTo: MessageReplyRef | undefined;
    const selfId = this.readString(payload.self_id);

    for (const segment of payload.message ?? []) {
      if (!segment.type) {
        continue;
      }
      if (segment.type === "text") {
        const text = this.readString(segment.data?.text);
        if (text) {
          inputs.push({ type: "text", text });
        }
        continue;
      }
      if (segment.type === "at") {
        const qq = this.readString(segment.data?.qq);
        if (!qq) {
          continue;
        }
        inputs.push({
          type: "text",
          text: formatMentionText(qq, qq === selfId),
        });
        continue;
      }
      if (segment.type === "reply") {
        const id = this.readString(segment.data?.id);
        if (id) {
          replyTo = {
            kind: "channel",
            channel: this.name,
            channelMessageId: id,
          };
        }
        continue;
      }
      if (segment.type === "face") {
        const faceText = this.resolveFaceText(segment.data);
        inputs.push({
          type: "text",
          text: faceText ? `[QQ表情：${faceText}]` : "[QQ表情]",
        });
        continue;
      }
      if (segment.type === "image") {
        const marketFaceText = this.resolveMarketFaceText(segment.data);
        if (marketFaceText) {
          inputs.push({
            type: "text",
            text: `[QQ表情：${marketFaceText}]`,
          });
          continue;
        }
        inputs.push(
          ...(await this.resolveMediaInputs(payload, "image", segment.data)),
        );
        continue;
      }
      if (segment.type === "file") {
        inputs.push(
          ...(await this.resolveMediaInputs(payload, "file", segment.data)),
        );
        continue;
      }
      if (segment.type === "video") {
        inputs.push(
          ...(await this.resolveMediaInputs(payload, "video", segment.data)),
        );
        continue;
      }
      if (segment.type === "record" || segment.type === "audio") {
        inputs.push(
          ...(await this.resolveMediaInputs(payload, "audio", segment.data)),
        );
      }
    }

    return { inputs, ...(replyTo ? { replyTo } : {}) };
  }

  private resolveFaceText(data: Record<string, unknown> | undefined): string {
    const text = this.readString(data?.text);
    if (text) {
      return text;
    }
    const faceText = this.readString(data?.faceText);
    if (faceText) {
      return faceText;
    }
    const raw = data?.raw;
    if (raw && typeof raw === "object" && "faceText" in raw) {
      const rawFaceText = this.readString(raw.faceText);
      if (rawFaceText) {
        return rawFaceText;
      }
    }
    const faceId = this.readString(data?.id) ?? this.readString(data?.face_id);
    if (faceId) {
      return faceId;
    }
    return "";
  }

  private resolveMarketFaceText(
    data: Record<string, unknown> | undefined,
  ): string | null {
    const summary = this.readString(data?.summary)?.trim() ?? "";
    const emojiId = this.readString(data?.emoji_id) ?? "";
    const emojiPackageId = this.readString(data?.emoji_package_id) ?? "";

    if (!summary && !emojiId && !emojiPackageId) {
      return null;
    }
    return summary || "[表情]";
  }

  private async resolveMediaInputs(
    payload: NapCatQQMessageEvent,
    kind: "image" | "file" | "video" | "audio",
    data: Record<string, unknown> | undefined,
  ): Promise<InputContent[]> {
    const hint = this.resolveMediaHint(data);
    const rawMimeType = this.readString(data?.mimeType);
    const mediaText = this.buildMediaText(kind, data);
    const base64 = this.extractBase64Payload(data);
    const mimeType = resolveSupportedMediaMimeType(rawMimeType, hint);

    if (base64) {
      if (!mimeType) {
        return [{ type: "text", text: mediaText }];
      }
      const sizeBytes = Buffer.byteLength(base64, "base64");
      if (!shouldAcceptMedia(mimeType, sizeBytes)) {
        return [{ type: "text", text: mediaText }];
      }
      return this.buildResolvedMediaInputs(mediaText, {
        type: "inline_data",
        mimeType,
        data: base64,
      });
    }

    const directURL = this.readString(data?.url);
    if (directURL) {
      const inline = await this.fetchInlineDataFromURL(
        directURL,
        mimeType,
        hint,
      );
      return inline
        ? this.buildResolvedMediaInputs(mediaText, inline)
        : [{ type: "text", text: mediaText }];
    }

    const fileId =
      this.readString(data?.file_id) ?? this.readString(data?.fileId);
    if (!fileId) {
      return [{ type: "text", text: mediaText }];
    }

    const resolvedURL = await this.resolveFileURL(payload, fileId);
    if (!resolvedURL) {
      return [{ type: "text", text: mediaText }];
    }

    const inline = await this.fetchInlineDataFromURL(
      resolvedURL,
      mimeType,
      hint,
    );
    return inline
      ? this.buildResolvedMediaInputs(mediaText, inline)
      : [{ type: "text", text: mediaText }];
  }

  private buildResolvedMediaInputs(
    mediaLabel: string,
    inline: Extract<InputContent, { type: "inline_data" }>,
  ): InputContent[] {
    return [{ type: "text", text: mediaLabel }, inline];
  }

  private async fetchInlineDataFromURL(
    url: string,
    mimeType: MIME | null,
    hint: string | null,
  ): Promise<Extract<InputContent, { type: "inline_data" }> | null> {
    if (!this.isHttpURL(url)) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }

      const resolvedMimeType =
        mimeType ??
        resolveSupportedMediaMimeType(
          response.headers.get("content-type"),
          hint,
        );
      if (!resolvedMimeType) {
        return null;
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        !shouldAcceptMedia(resolvedMimeType, contentLength)
      ) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!shouldAcceptMedia(resolvedMimeType, buffer.byteLength)) {
        return null;
      }

      return {
        type: "inline_data",
        mimeType: resolvedMimeType,
        data: buffer.toString("base64"),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveFileURL(
    payload: NapCatQQMessageEvent,
    fileId: string,
  ): Promise<string | null> {
    let response: ChannelResponse | null = null;

    if (payload.message_type === "group") {
      const groupId = this.readString(payload.group_id);
      if (!groupId) {
        return null;
      }
      response = await this.call(
        {
          method: "get_group_file_url",
          params: {
            group_id: groupId,
            file_id: fileId,
          },
        },
        { timeoutMs: FILE_URL_REQUEST_TIMEOUT_MS },
      );
    } else if (payload.message_type === "private") {
      const userId = this.readString(payload.user_id);
      if (!userId) {
        return null;
      }
      response = await this.call(
        {
          method: "get_private_file_url",
          params: {
            user_id: userId,
            file_id: fileId,
          },
        },
        { timeoutMs: FILE_URL_REQUEST_TIMEOUT_MS },
      );
    }

    if (!response?.ok || !response.data || typeof response.data !== "object") {
      return null;
    }

    const responseData = response.data as Record<string, unknown>;
    const url =
      this.readString(responseData.url) ?? this.readString(responseData.file);
    return this.isHttpURL(url) ? url : null;
  }

  private buildMediaText(
    kind: "image" | "file" | "video" | "audio",
    data: Record<string, unknown> | undefined,
  ): string {
    const fileName = this.resolveMediaName(data);
    if (fileName) {
      if (kind === "image") {
        return `[图片：${fileName}]`;
      }
      if (kind === "video") {
        return `[视频：${fileName}]`;
      }
      if (kind === "audio") {
        return `[音频：${fileName}]`;
      }
      return `[文件：${fileName}]`;
    }
    if (kind === "image") {
      return "[图片]";
    }
    if (kind === "video") {
      return "[视频]";
    }
    if (kind === "audio") {
      return "[音频]";
    }
    return "[文件]";
  }

  private resolveMediaHint(
    data: Record<string, unknown> | undefined,
  ): string | null {
    return (
      this.resolveMediaName(data) ??
      this.readString(data?.url) ??
      this.readString(data?.mimeType) ??
      null
    );
  }

  private resolveMediaName(
    data: Record<string, unknown> | undefined,
  ): string | null {
    const candidates = [data?.name, data?.file_name, data?.file];
    for (const candidate of candidates) {
      const value = this.readString(candidate);
      if (!value || value.startsWith("base64://")) {
        continue;
      }
      return value;
    }
    return null;
  }

  private extractBase64Payload(
    data: Record<string, unknown> | undefined,
  ): string | null {
    const direct = this.readString(data?.base64);
    if (direct) {
      return direct.startsWith("base64://")
        ? direct.slice("base64://".length)
        : direct;
    }

    const file = this.readString(data?.file);
    if (file?.startsWith("base64://")) {
      return file.slice("base64://".length);
    }
    return null;
  }

  private isHttpURL(value: string | null | undefined): value is string {
    return !!value && /^https?:\/\//i.test(value);
  }

  private readString(value: unknown): string | null {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
    return null;
  }

  private resolveEventTime(time: number | string | undefined): number {
    if (typeof time === "number" && Number.isFinite(time)) {
      return time * 1000;
    }
    if (typeof time === "string") {
      const parsed = Number(time);
      if (Number.isFinite(parsed)) {
        return parsed * 1000;
      }
    }
    return Date.now();
  }

  private buildSpeaker(
    payload: NapCatQQMessageEvent,
  ): SpeakerInformation | null {
    const userId = payload.user_id;
    if (typeof userId === "undefined" || userId === null) {
      return null;
    }

    const speakerUid = String(payload.sender?.user_id ?? payload.user_id);
    const speakerName =
      payload.sender?.card?.trim() ||
      payload.sender?.nickname?.trim() ||
      speakerUid;

    if (payload.message_type === "group") {
      if (
        typeof payload.group_id === "undefined" ||
        payload.group_id === null
      ) {
        return null;
      }
      return {
        session: buildSession(this.name, "group", String(payload.group_id)),
        uid: speakerUid,
        name: speakerName,
      };
    }

    if (payload.message_type === "private") {
      return {
        session: buildSession(this.name, "chat", String(userId)),
        uid: speakerUid,
        name: speakerName,
      };
    }

    return null;
  }
}
