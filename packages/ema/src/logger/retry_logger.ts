import { LoggerBase } from "./base";
import type {
  LoggerMode,
  LoggerLevel,
} from "./base";

export class RetryLogger extends LoggerBase {
  constructor(mode: LoggerMode | LoggerMode[], level: LoggerLevel) {
    super("RetryLogger", mode, level);
  }
}
