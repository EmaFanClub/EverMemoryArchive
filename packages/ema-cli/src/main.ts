import { Cli, Builtins } from "clipanion";
import { ReplCommand } from "./repl";
import { DbSnapshotCommand, DbRestoreCommand } from "./db";

const [_node, _app, ...args] = process.argv;

const cli = new Cli({
  binaryLabel: `ema`,
  binaryName: `ema-cli`,
  binaryVersion: `0.1.0`,
});

cli.register(ReplCommand);
cli.register(DbSnapshotCommand);
cli.register(DbRestoreCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.runExit(args);
