export interface WordCue {
  word: string;
  startTime: number;
  endTime: number;
}

export interface CaptionCue {
  id: number;
  text: string;
  startTime: number;
  endTime: number;
  words: WordCue[];
}

export interface SubtitleStyle {
  fontSize: number; // percentage of video height
  positionY: number; // percentage from bottom
  fontFamily: string;
  color: string;
  backgroundColor: string;
  highlightColor: string;
  showBackground: boolean;
  enableHighlight: boolean;
}

export enum TranscriptionStatus {
  IDLE = 'IDLE',
  PREPARING = 'PREPARING',
  TRANSCRIBING = 'TRANSCRIBING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  RENDERING = 'RENDERING',
  DOWNLOADING = 'DOWNLOADING',
}