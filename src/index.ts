#!/usr/bin/env node
import inquirer from "inquirer";
import { video_info, stream, validate, YouTubeStream } from "play-dl";
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
const DEBUG = true; // Force debug mode on to see what's happening

async function downloadVideo(
  options: DownloadOptions
): Promise<DownloadResult> {
  const spinner = ora("Preparing download...").start();

  try {
    // Create download directory if it doesn't exist
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    // Validate the URL first
    console.log("Validating URL:", options.url);
    const isValid = await validate(options.url);
    if (isValid !== "yt_video") {
      throw new ValidationError("Invalid YouTube URL");
    }

    // Get video information
    spinner.text = "Getting video information...";
    console.log("Fetching video info...");
    const videoInfo = await video_info(options.url);
    console.log("Video info received:", {
      title: videoInfo.video_details.title,
      duration: videoInfo.video_details.durationInSec,
      formats: videoInfo.format.map((f) => ({
        quality: f.quality,
        itag: f.itag,
      })),
    });

    // Prepare filename
    const sanitizedTitle = videoInfo.video_details.title
      ? videoInfo.video_details.title
          .replace(/[/\\?%*:|"<>]/g, "-")
          .substring(0, 200)
      : "video";

    const extension = options.format === "audio" ? "mp3" : "mp4";
    const filename = `${sanitizedTitle}.${extension}`;
    const filePath = path.join(DOWNLOAD_DIR, filename);

    // Make sure we don't have a partial file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    console.log("File details:", { filename, filePath });

    // Create stream with specific format
    spinner.text = "Creating download stream...";

    // Find best format
    const format = videoInfo.format.find((f) =>
      options.format === "audio" ? f.itag === 140 : f.itag === 18
    );

    if (!format) {
      throw new Error("No suitable format found");
    }

    console.log("Selected format:", format);

    const streamOptions = {
      quality: format.itag,
      ...(options.format === "audio" && { discordPlayerCompatibility: true }),
    };

    console.log("Stream options:", streamOptions);
    const downloadStream = await stream(options.url, streamOptions);

    if (!downloadStream || !downloadStream.stream) {
      throw new Error("Failed to create download stream");
    }

    console.log("Stream created successfully");
    spinner.text = "Starting download...";

    return new Promise<DownloadResult>((resolve, reject) => {
      let downloadedSize = 0;
      let lastDownloadedSize = 0;
      const startTime = Date.now();
      const writeStream = fs.createWriteStream(filePath);
      let lastUpdate = Date.now();

      const updateProgress = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastUpdate) / 1000;
        const bytesInInterval = downloadedSize - lastDownloadedSize;
        const speed = bytesInInterval / elapsed;

        const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(2);
        const speedMB = (speed / (1024 * 1024)).toFixed(2);

        spinner.text = `Downloading... ${downloadedMB} MB (${speedMB} MB/s)`;

        lastUpdate = now;
        lastDownloadedSize = downloadedSize;

        // Log progress for debugging
        console.log("Download progress:", {
          downloadedMB,
          speedMB,
          elapsed: ((now - startTime) / 1000).toFixed(2),
        });
      }, 1000);

      const cleanup = (error?: Error) => {
        clearInterval(updateProgress);
        if (error && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("Cleaned up incomplete download");
        }
      };

      downloadStream.stream
        .on("data", (chunk: Buffer) => {
          downloadedSize += chunk.length;
          // Log every 1MB of data
          if (downloadedSize % (1024 * 1024) === 0) {
            console.log(`Received ${downloadedSize / (1024 * 1024)}MB of data`);
          }
        })
        .on("end", () => {
          console.log("Download stream ended");
          writeStream.end();
        })
        .on("error", (error: Error) => {
          console.error("Stream error:", error);
          cleanup(error);
          writeStream.end();
          reject(new DownloadError("Download stream error", error));
        });

      writeStream
        .on("finish", () => {
          console.log("Write stream finished");
          cleanup();
          const duration = (Date.now() - startTime) / 1000;
          const result: DownloadResult = {
            filename,
            filePath,
            duration,
            format: options.format,
            size: downloadedSize,
          };
          spinner.succeed(`Download completed! Saved as: ${filename}`);
          resolve(result);
        })
        .on("error", (error: Error) => {
          console.error("Write stream error:", error);
          cleanup(error);
          spinner.fail("File write error!");
          reject(new FileSystemError("Write stream error", error));
        });

      // Add error handler for pipe
      downloadStream.stream.pipe(writeStream).on("error", (error: Error) => {
        console.error("Pipe error:", error);
        cleanup(error);
        reject(new DownloadError("Pipe error", error));
      });

      // Add timeout to detect stalled downloads
      setTimeout(() => {
        if (downloadedSize === 0) {
          const error = new Error("Download timed out - no data received");
          cleanup(error);
          reject(new DownloadError("Download timeout", error));
        }
      }, 30000); // 30 second timeout
    });
  } catch (error) {
    console.error("Download error:", error);
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
    console.log("Application started");

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

    console.log("User input:", answers);

    await downloadVideo({
      url: answers.url,
      format: answers.format as VideoFormat,
    });
  } catch (error) {
    console.error("Main error:", error);
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

async function validateYouTubeUrl(url: string): Promise<boolean> {
  try {
    if (!url) throw new ValidationError("URL cannot be empty");
    const validationResult = await validate(url);
    console.log(`URL validation result: ${validationResult}`);
    return validationResult === "yt_video";
  } catch (error) {
    console.error("URL Validation Error:", error);
    return false;
  }
}

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  logger.error("Unhandled Rejection:", reason);
  process.exit(1);
});

// Start the application
main().catch((error) => {
  console.error("Application error:", error);
  logger.error("Application error:", error);
  process.exit(1);
});
