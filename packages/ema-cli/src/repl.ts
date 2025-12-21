import { Command } from "clipanion";
import { main } from "../../ema/src/run_agent";

export class ReplCommand extends Command {
  static paths = [[`repl`]];

  static usage = Command.Usage({
    description: "Start a REPL session with the EMA agent",
    details: "Starts a REPL session with the EMA agent.",
    examples: [["Start a REPL session with the EMA agent", "ema repl"]],
  });

  async execute() {
    await main().catch((err) => {
      console.error("Fatal error in run_agent:", err);
      process.exit(1);
    });
  }
}
