import type { Server } from "../server";
import { ActorController } from "./actor_controller";
import { ChannelController } from "./channel_controller";
import { ChatController } from "./chat_controller";
import { RuntimeController } from "./runtime_controller";
import { ScheduleController } from "./schedule_controller";
import { SettingsController } from "./settings_controller";
import { SetupController } from "./setup_controller";

export class EmaController {
  readonly setup: SetupController;
  readonly actor: ActorController;
  readonly runtime: RuntimeController;
  readonly settings: SettingsController;
  readonly chat: ChatController;
  readonly channel: ChannelController;
  readonly schedule: ScheduleController;

  constructor(server: Server) {
    this.setup = new SetupController(server);
    this.actor = new ActorController(server);
    this.runtime = new RuntimeController(server);
    this.settings = new SettingsController(server);
    this.chat = new ChatController(server);
    this.channel = new ChannelController(server);
    this.schedule = new ScheduleController(server);
  }
}
