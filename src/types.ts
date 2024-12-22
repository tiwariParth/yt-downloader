export type VideoFormat = "audio" | "video";

export interface DownloadOptions {
  url: string;
  format: VideoFormat;
  quality?: string;
}

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  speed: number; // bytes per second
}

export interface DownloadResult {
  filename: string;
  filePath: string;
  duration: number; // in seconds
  format: VideoFormat;
  size: number; // in bytes
}

export interface VideoFormatInfo {
  quality: string;
  hasAudio: boolean;
  hasVideo: boolean;
  container: string;
  itag: number;
}
