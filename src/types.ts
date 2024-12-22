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
