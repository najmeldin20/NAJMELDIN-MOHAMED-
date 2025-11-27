export enum Language {
  ARABIC = 'ar',
  ENGLISH = 'en'
}

export interface TafsirResponse {
  originalText: string;
  interpretation: string;
}

export enum AppStatus {
  IDLE = 'idle',
  GENERATING_TEXT = 'generating_text',
  GENERATING_AUDIO = 'generating_audio',
  PLAYING = 'playing',
  ERROR = 'error'
}

export interface AudioVisualizerProps {
  isPlaying: boolean;
}