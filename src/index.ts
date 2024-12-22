#!/usr/bin/env node
import inquirer from "inquirer";
import ytdl from "ytdl-core";
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
} from "./errors";
import { debugLog } from "./utils/logger";

async function validateYouTubeUrl(url: string): Promise<boolean> {
  try {
    if (!url) {
      throw new ValidationError("URL cannot be empty");
    }
    return ytdl.validateURL(url);
  } catch (error) {
    debugLog("URL Validation Error:", error);
    return false;
  }
}

async function getVideoInfo(url: string): Promise<ytdl.videoInfo> {
  try {
    debugLog("Fetching video info for:", url);
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+",
        },
      },
    });
    debugLog("Video info fetched successfully");
    return info;
  } catch (error: unknown) {
    debugLog("Error fetching video info:", error);
    if (error instanceof Error) {
      if (error.message.includes("age-restricted")) {
        throw new VideoInfoError(
          "This video is age-restricted and cannot be downloaded",
          error
        );
      }
      if (error.message.includes("Could not extract")) {
        throw new VideoInfoError(
          "YouTube made changes that prevent downloading. Please update ytdl-core",
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
      new Error(String(error))
    );
  }
}

async function downloadVideo(
  options: DownloadOptions
): Promise<DownloadResult> {
  const spinner = ora("Starting download...").start();
  let cleanup: (() => void) | null = null;

  try {
    debugLog("Starting download with options:", options);
    const info = await getVideoInfo(options.url);

    const sanitizedTitle = info.videoDetails.title
      .replace(/[/\\?%*:|"<>]/g, "-")
      .substring(0, 200);

    const filename = `${sanitizedTitle}.${
      options.format === "audio" ? "mp3" : "mp4"
    }`;

    debugLog("Creating write stream for:", filename);
    const writeStream = fs.createWriteStream(filename);
    let starttime = Date.now();

    // Setup cleanup function
    cleanup = () => {
      try {
        if (fs.existsSync(filename)) {
          fs.unlinkSync(filename);
          debugLog("Cleaned up incomplete file:", filename);
        }
      } catch (error) {
        debugLog("Error during cleanup:", error);
      }
    };

    const stream = ytdl(options.url, {
      filter:
        options.format === "audio"
          ? "audioonly"
          : (format) => format.hasVideo && format.hasAudio,
      quality: options.format === "audio" ? "highestaudio" : "highest",
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+",
        },
      },
    });

    return new Promise((resolve, reject) => {
      let downloadedBytes = 0;
      let totalBytes = 0;
      let lastUpdate = Date.now();

      stream.on("progress", (_, downloaded, total) => {
        downloadedBytes = downloaded;
        totalBytes = total;
        const now = Date.now();
        const progress: DownloadProgress = {
          downloadedBytes: downloaded,
          totalBytes: total,
          percentage: (downloaded / total) * 100,
          speed: downloaded / ((now - starttime) / 1000),
        };

        if (now - lastUpdate > 1000) {
          // Update not more than once per second
          spinner.text = `Downloading... ${progress.percentage.toFixed(2)}% (${(
            progress.speed /
            1024 /
            1024
          ).toFixed(2)} MB/s)`;
          lastUpdate = now;
        }
        debugLog("Download progress:", progress);
      });

      stream.pipe(writeStream);

      writeStream.on("finish", () => {
        const endtime = Date.now();
        const seconds = (endtime - starttime) / 1000;
        spinner.succeed(
          `Download completed in ${seconds.toFixed(
            2
          )}s! File saved as: ${filename}`
        );

        const result: DownloadResult = {
          filename,
          duration: seconds,
          format: options.format,
          size: downloadedBytes,
        };
        debugLog("Download completed:", result);
        resolve(result);
      });

      stream.on("error", (error: Error) => {
        debugLog("Stream error:", error);
        cleanup?.();
        reject(new DownloadError("Error during download", error));
      });

      writeStream.on("error", (error: Error) => {
        debugLog("Write stream error:", error);
        cleanup?.();
        reject(new FileSystemError("Error writing to file", error, filename));
      });
    });
  } catch (error: unknown) {
    debugLog("Download error:", error);
    cleanup?.();
    spinner.fail("Download failed!");
    if (error instanceof YouTubeDownloaderError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new DownloadError("Download failed", error);
    }
    throw new DownloadError(
      "An unknown error occurred",
      new Error(String(error))
    );
  }
}

async function main() {
  try {
    debugLog("Starting application");
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "url",
        message: "Enter YouTube video URL:",
        validate: async (input) => {
          try {
            const isValid = await validateYouTubeUrl(input);
            return isValid ? true : "Please enter a valid YouTube URL";
          } catch (error) {
            if (error instanceof ValidationError) {
              return error.message;
            }
            return "Invalid URL format";
          }
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

    debugLog("Download completed successfully:", result);
  } catch (error: unknown) {
    if (error instanceof YouTubeDownloaderError) {
      console.error(`${error.name} (${error.code}):`, error.message);
      debugLog("Application error details:", error);
    } else if (error instanceof Error) {
      console.error("Unexpected error:", error.message);
      debugLog("Unexpected error details:", error);
    } else {
      console.error("An unknown error occurred");
      debugLog("Unknown error:", error);
    }
    process.exit(1);
  }
}

// Add debug mode detection
const DEBUG_MODE = process.env.DEBUG === "true";

if (DEBUG_MODE) {
  console.log("Debug mode enabled");
}

main().catch((error) => {
  debugLog("Uncaught error:", error);
  console.error("Fatal error:", error);
  process.exit(1);
});
