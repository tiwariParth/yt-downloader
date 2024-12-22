#!/usr/bin/env node
import inquirer from "inquirer";
import { video_info, stream, validate } from "play-dl";
import ora from "ora";
import fs from "fs";
import path from "path";
import { VideoFormat, DownloadOptions, DownloadResult } from "./types";
import {
  YouTubeDownloaderError,
  VideoInfoError,
  DownloadError,
  FileSystemError,
  ValidationError,
} from "./types/errors";
import { logger } from "./utils/logger";

const DOWNLOAD_DIR = path.join(process.cwd(), "videos");
const DEBUG = process.env.DEBUG === "true";

function debug(message: string, ...args: any[]): void {
  if (DEBUG) {
    logger.info(`[DEBUG] ${message}`, ...args);
  }
}

function ensureDownloadDirectory(): void {
  try {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      debug(`Created download directory: ${DOWNLOAD_DIR}`);
    }
  } catch (error) {
    throw new FileSystemError(
      "Failed to create download directory",
      error as Error
    );
  }
}

async function validateYouTubeUrl(url: string): Promise<boolean> {
  try {
    if (!url) throw new ValidationError("URL cannot be empty");
    const validationResult = await validate(url);
    debug(`URL validation result: ${validationResult}`);
    return validationResult === "yt_video";
  } catch (error) {
    logger.error("URL Validation Error:", error);
    return false;
  }
}

async function downloadVideo(
  options: DownloadOptions
): Promise<DownloadResult> {
  const spinner = ora("Preparing download...").start();
  const startTime = Date.now();
  let writeStream: fs.WriteStream | null = null;

  try {
    debug("Starting download with options:", options);
    ensureDownloadDirectory();

    // Get video info
    debug("Fetching video info...");
    const info = await video_info(options.url);
    if (!info) {
      throw new VideoInfoError("Failed to get video info", new Error());
    }
    debug("Video info retrieved:", {
      title: info.video_details.title,
      duration: info.video_details.durationInSec,
      available_formats: info.format.map((f) => f.itag),
    });

    // Get video formats
    const formats = info.format;
    if (!formats || formats.length === 0) {
      throw new VideoInfoError("No formats available", new Error());
    }

    // Select appropriate format
    const format =
      options.format === "audio"
        ? formats.find((f) => f.itag === 140) // m4a audio
        : formats.find((f) => f.itag === 18); // mp4 360p

    if (!format) {
      debug(
        "Available formats:",
        formats.map((f) => ({ itag: f.itag, quality: f.quality }))
      );
      throw new VideoInfoError("Selected format not available", new Error());
    }
    debug("Selected format:", { itag: format.itag, quality: format.quality });

    // Prepare filename
    const sanitizedTitle = info.video_details.title
      ? info.video_details.title
          .replace(/[/\\?%*:|"<>]/g, "-")
          .substring(0, 200)
      : "video";

    const extension = options.format === "audio" ? "m4a" : "mp4";
    const filename = `${sanitizedTitle}.${extension}`;
    const filePath = path.join(DOWNLOAD_DIR, filename);

    debug("File details:", { filename, filePath });
    spinner.text = "Starting download...";

    // Create stream with specific format
    debug("Creating stream...");
    const videoStream = await stream(options.url, {
      quality: format.itag,
      ...(options.format === "audio"
        ? { discordPlayerCompatibility: true }
        : {}),
    });

    if (!videoStream || !videoStream.stream) {
      throw new DownloadError("Failed to create stream", new Error());
    }

    writeStream = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    let downloadStartTime = Date.now();
    let lastUpdate = Date.now();
    let lastBytes = 0;

    return new Promise<DownloadResult>((resolve, reject) => {
      const updateProgress = () => {
        const now = Date.now();
        const elapsedTime = (now - downloadStartTime) / 1000;
        const intervalTime = (now - lastUpdate) / 1000;
        const bytesInInterval = downloadedBytes - lastBytes;
        const currentSpeed = bytesInInterval / intervalTime;

        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
        const speedMB = (currentSpeed / (1024 * 1024)).toFixed(2);

        spinner.text = `Downloading... ${downloadedMB} MB (${speedMB} MB/s)`;

        lastUpdate = now;
        lastBytes = downloadedBytes;

        debug("Download progress:", {
          downloadedMB,
          speedMB,
          elapsedTime: elapsedTime.toFixed(2),
        });
      };

      const progressInterval = setInterval(updateProgress, 1000);

      const cleanup = (error?: Error) => {
        debug("Running cleanup...", error ? { error: error.message } : {});
        clearInterval(progressInterval);

        if (writeStream) {
          writeStream.end();
        }

        if (error && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            debug("Cleaned up incomplete download file");
          } catch (cleanupError) {
            logger.error("Failed to cleanup file:", cleanupError);
          }
        }
      };

      if (!writeStream) {
        cleanup(new Error("Write stream not initialized"));
        reject(
          new FileSystemError("Write stream not initialized", new Error())
        );
        return;
      }

      videoStream.stream
        .on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
        })
        .on("end", () => {
          debug("Stream ended");
          clearInterval(progressInterval);
        })
        .on("error", (error: Error) => {
          debug("Stream error:", error);
          cleanup(error);
          spinner.fail("Download stream error!");
          reject(new DownloadError("Stream error occurred", error));
        });

      writeStream
        .on("finish", () => {
          debug("Write stream finished");
          cleanup();
          const duration = (Date.now() - startTime) / 1000;
          const result: DownloadResult = {
            filename,
            filePath,
            duration,
            format: options.format,
            size: downloadedBytes,
          };
          spinner.succeed(`Download completed! Saved as: ${filename}`);
          resolve(result);
        })
        .on("error", (error: Error) => {
          debug("Write stream error:", error);
          cleanup(error);
          spinner.fail("File write error!");
          reject(new FileSystemError("Write stream error", error));
        });

      videoStream.stream.pipe(writeStream);
    });
  } catch (error) {
    spinner.fail("Download failed!");
    debug("Download failed with error:", error);
    if (writeStream) {
      writeStream.end();
    }
    if (error instanceof YouTubeDownloaderError) {
      throw error;
    }
    throw new DownloadError(
      "Download failed",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

async function main() {
  try {
    logger.info("Starting YouTube Downloader");
    debug("Application started");

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "url",
        message: "Enter YouTube video URL:",
        validate: async (input) => {
          const isValid = await validateYouTubeUrl(input);
          return isValid ? true : "Please enter a valid YouTube URL";
        },
      },
      {
        type: "list",
        name: "format",
        message: "Choose format:",
        choices: ["video", "audio"] as VideoFormat[],
      },
    ]);

    debug("User input:", answers);

    await downloadVideo({
      url: answers.url,
      format: answers.format as VideoFormat,
    });
  } catch (error) {
    debug("Main error:", error);
    if (error instanceof YouTubeDownloaderError) {
      logger.error(error);
    } else if (error instanceof Error) {
      logger.error(
        new YouTubeDownloaderError(error.message, "UNKNOWN_ERROR", error)
      );
    } else {
      logger.error(
        new YouTubeDownloaderError(
          "An unknown error occurred",
          "UNKNOWN_ERROR",
          error
        )
      );
    }
    process.exit(1);
  }
}

process.on("uncaughtException", (error) => {
  debug("Uncaught Exception:", error);
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  debug("Unhandled Rejection:", reason);
  logger.error("Unhandled Rejection:", reason);
  process.exit(1);
});

main().catch((error) => {
  debug("Application error:", error);
  logger.error("Application error:", error);
  process.exit(1);
});
