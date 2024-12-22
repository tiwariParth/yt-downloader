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

function ensureDownloadDirectory(): void {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    logger.info(`Created download directory: ${DOWNLOAD_DIR}`);
  }
}

async function validateYouTubeUrl(url: string): Promise<boolean> {
  try {
    if (!url) throw new ValidationError("URL cannot be empty");
    return (await validate(url)) === "yt_video";
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

  try {
    ensureDownloadDirectory();
    const info = await video_info(options.url);

    const quality = options.format === "audio" ? 140 : 18;

    const sanitizedTitle = info.video_details.title
      ? info.video_details.title
          .replace(/[/\\?%*:|"<>]/g, "-")
          .substring(0, 200)
      : "video";

    const extension = options.format === "audio" ? "mp3" : "mp4";
    const filename = `${sanitizedTitle}.${extension}`;
    const filePath = path.join(DOWNLOAD_DIR, filename);

    spinner.text = "Initializing download...";

    const videoStream = await stream(options.url, {
      quality,
      ...(options.format === "audio"
        ? { discordPlayerCompatibility: true }
        : {}),
    });

    if (!videoStream || !videoStream.stream) {
      throw new DownloadError("Failed to initialize stream", new Error());
    }

    const writeStream = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    let lastDownloadedBytes = 0;
    let lastUpdateTime = Date.now();

    return new Promise<DownloadResult>((resolve, reject) => {
      const progressInterval = setInterval(() => {
        const currentTime = Date.now();
        const timeDiff = (currentTime - lastUpdateTime) / 1000;
        const bytesDiff = downloadedBytes - lastDownloadedBytes;
        const speed = bytesDiff / timeDiff;

        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
        const speedMB = (speed / (1024 * 1024)).toFixed(2);

        spinner.text = `Downloading... ${downloadedMB} MB (${speedMB} MB/s)`;

        lastDownloadedBytes = downloadedBytes;
        lastUpdateTime = currentTime;
      }, 1000);

      const cleanup = (error?: Error) => {
        clearInterval(progressInterval);
        if (error && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            logger.info("Cleaned up incomplete download");
          } catch (cleanupError) {
            logger.error("Failed to cleanup file:", cleanupError);
          }
        }
      };

      videoStream.stream
        .on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
        })
        .on("error", (error: Error) => {
          cleanup(error);
          spinner.fail("Download failed!");
          reject(new DownloadError("Stream error occurred", error));
        })
        .on("end", () => {
          logger.info("Stream ended");
        });

      writeStream
        .on("finish", () => {
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
          cleanup(error);
          spinner.fail("Failed to write file!");
          reject(new FileSystemError("Write stream error", error));
        });

      videoStream.stream.pipe(writeStream);
    });
  } catch (error) {
    spinner.fail("Download failed!");
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

    await downloadVideo({
      url: answers.url,
      format: answers.format as VideoFormat,
    });
  } catch (error) {
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
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
  process.exit(1);
});

main().catch((error) => {
  logger.error("Application error:", error);
  process.exit(1);
});
