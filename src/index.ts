#!/usr/bin/env node
import inquirer from "inquirer";
import ytdl from "ytdl-core";
import ora from "ora";
import fs from "fs";
import path from "path";
import { VideoFormat, DownloadOptions } from "./types";

async function validateYouTubeUrl(url: string): Promise<boolean> {
  return ytdl.validateURL(url);
}

async function getVideoInfo(url: string) {
  try {
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          // Add headers to mimic a real browser request
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
    });
    return info;
  } catch (error) {
    console.error("Detailed error:", error);
    throw new Error("Failed to get video information");
  }
}

async function downloadVideo(options: DownloadOptions) {
  const spinner = ora("Starting download...").start();

  try {
    const info = await getVideoInfo(options.url);

    // Sanitize filename to remove invalid characters
    const sanitizedTitle = info.videoDetails.title.replace(
      /[/\\?%*:|"<>]/g,
      "-"
    );
    const filename = `${sanitizedTitle}.${
      options.format === "audio" ? "mp3" : "mp4"
    }`;

    // Create a write stream
    const writeStream = fs.createWriteStream(filename);

    // Handle download progress
    let downloadedBytes = 0;
    let totalBytes = 0;

    if (options.format === "audio") {
      const stream = ytdl(options.url, {
        filter: "audioonly",
        quality: "highestaudio",
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
      });

      stream.pipe(writeStream);

      stream.on("progress", (_, downloaded, total) => {
        downloadedBytes = downloaded;
        totalBytes = total;
        const progress = ((downloaded / total) * 100).toFixed(2);
        spinner.text = `Downloading... ${progress}%`;
      });
    } else {
      const stream = ytdl(options.url, {
        filter: (format) => format.hasVideo && format.hasAudio,
        quality: "highest",
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
      });

      stream.pipe(writeStream);

      stream.on("progress", (_, downloaded, total) => {
        downloadedBytes = downloaded;
        totalBytes = total;
        const progress = ((downloaded / total) * 100).toFixed(2);
        spinner.text = `Downloading... ${progress}%`;
      });
    }

    // Handle completion
    writeStream.on("finish", () => {
      spinner.succeed(`Download completed! File saved as: ${filename}`);
    });

    // Handle errors
    writeStream.on("error", (error) => {
      spinner.fail("Error writing file!");
      console.error("Write stream error:", error);
    });
  } catch (error) {
    spinner.fail("Download failed!");
    console.error("Download error:", error);
  }
}

async function main() {
  try {
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

    await downloadVideo({
      url: answers.url,
      format: answers.format as "video" | "audio",
    });
  } catch (error) {
    console.error("Application error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
