export interface VideoFormat {
  quality: string;
  hasAudio: boolean;
  hasVideo: boolean;
  container: string;
  itag: number;
}

export interface DownloadOptions {
  url: string;
  format: "audio" | "video";
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
  format: string;
  size: number; // in bytes
}
