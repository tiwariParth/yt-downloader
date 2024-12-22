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
      quality = 140; // M4A audio (128kbps)
    } else {
      const availableQualities = streamFormats
        .map((format) => format.itag)
        .filter((itag) => typeof itag === "number") as number[];

      const preferredQualities = [137, 136, 135, 134]; // 1080p, 720p, 480p, 360p
      quality =
        preferredQualities.find((q) => availableQualities.includes(q)) || 136;

      logger.info(`Available qualities: ${availableQualities.join(", ")}`);
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

    const videoStream = await stream(options.url, {
      quality,
      ...(options.format === "audio"
        ? { discordPlayerCompatibility: true }
        : {}),
    });

    const writeStream = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    const selectedFormat = streamFormats.find(
      (format) => format.itag === quality
    );
    const totalBytes = selectedFormat?.contentLength
      ? parseInt(selectedFormat.contentLength)
      : 0;

    let lastBytes = 0;
    let lastTime = Date.now();
    const updateInterval = setInterval(() => {
      const currentBytes = downloadedBytes;
      const currentTime = Date.now();
      const bytesPerSecond =
        (currentBytes - lastBytes) / ((currentTime - lastTime) / 1000);
      lastBytes = currentBytes;
      lastTime = currentTime;

      const progress: DownloadProgress = {
        downloadedBytes: currentBytes,
        totalBytes,
        percentage: totalBytes ? (currentBytes / totalBytes) * 100 : 0,
        speed: bytesPerSecond,
      };

      const percent = progress.percentage.toFixed(2);
      const speed = (bytesPerSecond / 1024 / 1024).toFixed(2);
      spinner.text = `Downloading... ${percent}% (${speed} MB/s)`;
      logger.info("Download progress", { ...progress, quality });
    }, 1000);

    const downloadPromise = new Promise<DownloadResult>((resolve, reject) => {
      writeStream.on("finish", () => {
        clearInterval(updateInterval);
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
        logger.success("Download completed", result);
        resolve(result);
      });

      writeStream.on("error", (error: Error) => {
        clearInterval(updateInterval);
        spinner.fail("Error writing file!");
        reject(new FileSystemError("Write stream error", error));
      });

      videoStream.stream.on("error", (error: Error) => {
        clearInterval(updateInterval);
        spinner.fail("Download error occurred!");
        const downloadError = new DownloadError("Stream error occurred", error);
        logger.error(downloadError);

        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            logger.info("Cleaned up partial download file");
          } catch (unlinkError) {
            logger.error(
              new FileSystemError(
                "Failed to clean up partial file",
                unlinkError
              )
            );
          }
        }
        reject(downloadError);
      });
    });

    videoStream.stream.on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;
    });

    videoStream.stream.pipe(writeStream);
    return await downloadPromise;
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
