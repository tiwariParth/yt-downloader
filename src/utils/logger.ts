import chalk from "chalk";
import { YouTubeDownloaderError } from "../types/errors";

type LogLevel = "info" | "warn" | "error" | "debug" | "success";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: any;
}

class Logger {
  private logs: LogEntry[] = [];
  private debugMode: boolean = false;

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    details?: any
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      message,
      details,
    };
    this.logs.push(entry);
    return entry;
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = chalk.gray(`[${entry.timestamp}]`);
    const level = this.colorizeLevel(entry.level.toUpperCase().padEnd(7));
    return `${timestamp} ${level} ${entry.message}`;
  }

  private colorizeLevel(level: string): string {
    switch (level.trim()) {
      case "INFO":
        return chalk.blue(level);
      case "WARN":
        return chalk.yellow(level);
      case "ERROR":
        return chalk.red(level);
      case "DEBUG":
        return chalk.magenta(level);
      case "SUCCESS":
        return chalk.green(level);
      default:
        return level;
    }
  }

  info(message: string, details?: any): void {
    const entry = this.createLogEntry("info", message, details);
    this.logToConsole(entry);
  }

  warn(message: string, details?: any): void {
    const entry = this.createLogEntry("warn", message, details);
    this.logToConsole(entry);
  }

  error(error: Error | YouTubeDownloaderError | string, details?: any): void {
    let message: string;
    let errorDetails: any = details;

    if (error instanceof YouTubeDownloaderError) {
      message = `[${error.code}] ${error.message}`;
      errorDetails = {
        ...errorDetails,
        code: error.code,
        details: error.details,
      };
    } else if (error instanceof Error) {
      message = error.message;
      errorDetails = { ...errorDetails, name: error.name, stack: error.stack };
    } else {
      message = error;
    }

    const entry = this.createLogEntry("error", message, errorDetails);
    this.logToConsole(entry);
  }

  success(message: string, details?: any): void {
    const entry = this.createLogEntry("success", message, details);
    this.logToConsole(entry);
  }

  private logToConsole(entry: LogEntry): void {
    const formattedMessage = this.formatMessage(entry);
    if (entry.details && this.debugMode) {
      console.log(formattedMessage);
      console.log(chalk.gray("Details:"), entry.details);
    } else {
      console.log(formattedMessage);
    }
  }
}

export const logger = new Logger(process.env.NODE_ENV === "development");
