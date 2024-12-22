export class YouTubeDownloaderError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message);
    this.name = "YouTubeDownloaderError";
  }
}

export class VideoInfoError extends YouTubeDownloaderError {
  constructor(message: string, details?: any) {
    super(message, "VIDEO_INFO_ERROR", details);
    this.name = "VideoInfoError";
  }
}

export class DownloadError extends YouTubeDownloaderError {
  constructor(message: string, details?: any) {
    super(message, "DOWNLOAD_ERROR", details);
    this.name = "DownloadError";
  }
}

export class FileSystemError extends YouTubeDownloaderError {
  constructor(message: string, details?: any) {
    super(message, "FILE_SYSTEM_ERROR", details);
    this.name = "FileSystemError";
  }
}

export class ValidationError extends YouTubeDownloaderError {
  constructor(message: string, details?: any) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}
