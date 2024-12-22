#!/usr/bin/env node
import inquirer from "inquirer";
import { video_info, stream, validate, InfoData, YouTubeStream } from "play-dl";
import ora from "ora";
import fs from "fs";
import path from "path";
import {
  VideoFormat,
  DownloadOptions,
  DownloadProgress,
  DownloadResult,
} from "./types";
import {
  YouTubeDownloaderError,
  VideoInfoError,
  DownloadError,
  FileSystemError,
  ValidationError,
} from "./types/errors";
import { logger } from "./utils/logger";
import { Stream } from "stream";

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

async function getVideoInfo(url: string): Promise<InfoData> {
  try {
    const info = await video_info(url);
    logger.success("Video info fetched successfully");
    return info;
  } catch (error: unknown) {
    logger.error("Error fetching video info:", error);
    if (error instanceof Error) {
      if (error.message.includes("age-restricted")) {
        throw new VideoInfoError(
          "This video is age-restricted and cannot be downloaded",
          error
        );
      }
      throw new VideoInfoError(
        `Failed to get video information: ${error.message}`,
        error
      );
    }
    throw new VideoInfoError(
      "An unknown error occurred while getting video information",
      error
    );
  }
}

async function downloadVideo(
  options: DownloadOptions
): Promise<DownloadResult> {
  const spinner = ora("Starting download...").start();
  const startTime = Date.now();

  try {
    ensureDownloadDirectory();
    const info = await video_info(options.url);
    const streamFormats = info.format;

    let quality: number;
    if (options.format === "audio") {
      quality = 251; // Changed to 251 for better audio quality (WebM Opus)
    } else {
      const availableQualities = streamFormats
        .map((format) => format.itag)
        .filter((itag) => typeof itag === "number") as number[];

      logger.info(`Available qualities: ${availableQualities.join(", ")}`);
      // Try to get the best available video quality
      quality = availableQualities.includes(22) ? 22 : 18; // 720p(22) or 360p(18)
    }

    const sanitizedTitle = info.video_details.title
      ? info.video_details.title
          .replace(/[/\\?%*:|"<>]/g, "-")
          .substring(0, 200)
      : "video";

    const filename = `${sanitizedTitle}.${
      options.format === "audio" ? "mp3" : "mp4"
    }`;
    const filePath = path.join(DOWNLOAD_DIR, filename);

    // Get format info for progress calculation
    const selectedFormat = streamFormats.find(
      (format) => format.itag === quality
    );
    if (!selectedFormat) {
      throw new DownloadError(
        "Selected quality format not available",
        new Error()
      );
    }

    logger.info(`Starting download with quality itag: ${quality}`);

    const videoStream = await stream(options.url, { quality });
    const writeStream = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    const totalBytes = selectedFormat.contentLength
      ? parseInt(selectedFormat.contentLength)
      : (info.video_details.durationInSec * 128000) / 8; // Estimate size for audio

    const updateProgress = () => {
      if (totalBytes) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(2);
        const downloaded = (downloadedBytes / 1024 / 1024).toFixed(2);
        const total = (totalBytes / 1024 / 1024).toFixed(2);
        spinner.text = `Downloading... ${percent}% (${downloaded}MB / ${total}MB)`;
      } else {
        spinner.text = `Downloading... ${(
          downloadedBytes /
          1024 /
          1024
        ).toFixed(2)}MB`;
      }
    };

    return new Promise((resolve, reject) => {
      const progressInterval = setInterval(updateProgress, 1000);

      videoStream.stream
        .on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
        })
        .on("end", () => {
          clearInterval(progressInterval);
        })
        .on("error", (error: Error) => {
          clearInterval(progressInterval);
          spinner.fail("Download error occurred!");
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(new DownloadError("Stream error occurred", error));
        });

      writeStream
        .on("finish", () => {
          clearInterval(progressInterval);
          const duration = (Date.now() - startTime) / 1000;
          const result: DownloadResult = {
            filename,
            filePath,
            duration,
            format: options.format,
            size: downloadedBytes,
          };
          spinner.succeed(
            `Download completed in ${duration.toFixed(
              2
            )}s! File saved in videos/${filename}`
          );
          resolve(result);
        })
        .on("error", (error: Error) => {
          clearInterval(progressInterval);
          spinner.fail("Error writing file!");
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(new FileSystemError("Write stream error", error));
        });

      videoStream.stream.pipe(writeStream);
    });
  } catch (error: unknown) {
    spinner.fail("Download failed!");
    if (error instanceof YouTubeDownloaderError) {
      throw error;
    }
    throw new DownloadError(
      "Download failed with unknown error",
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
        choices: ["video", "audio"],
      },
    ]);

    const result = await downloadVideo({
      url: answers.url,
      format: answers.format as "video" | "audio",
    });

    logger.success("Process completed successfully", result);
  } catch (error: unknown) {
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
