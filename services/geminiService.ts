import { GoogleGenAI, Type } from '@google/genai';
import { TranscriptionStatus, CaptionCue, WordCue } from '../types';

// Helper to write a string to a DataView
function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

// Helper to convert a mono AudioBuffer to a Base64 encoded WAV string
async function audioBufferToWavBase64(buffer: AudioBuffer): Promise<string> {
    const sampleRate = buffer.sampleRate;
    const numChannels = 1;
    const bitDepth = 16;
    
    const pcmData = new Int16Array(buffer.length);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) {
        // Clamp and convert to 16-bit PCM
        pcmData[i] = Math.max(-1, Math.min(1, channelData[i])) * 32767;
    }

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const dataSize = pcmData.byteLength;

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // file length - 8
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size for PCM
    view.setUint16(20, 1, true); // AudioFormat 1 for PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true); // byteRate
    view.setUint16(32, numChannels * (bitDepth / 8), true); // blockAlign
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const wavBlob = new Blob([view, pcmData], { type: 'audio/wav' });

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result as string)?.split(',')[1];
            if (!base64String) {
                reject(new Error("Failed to convert audio to base64."));
            } else {
                resolve(base64String);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(wavBlob);
    });
}

export const transcribeAudio = async (
    audioBuffer: AudioBuffer,
    setTranscriptionStatus: (status: TranscriptionStatus) => void,
    setStatusMessage: (message: string) => void
): Promise<string> => {
    if (!process.env.API_KEY) {
        const errorMsg = "API key not found. Please set the API_KEY environment variable.";
        setStatusMessage(errorMsg);
        setTranscriptionStatus(TranscriptionStatus.ERROR);
        throw new Error(errorMsg);
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
        setStatusMessage("Preparing audio for AI transcription...");
        setTranscriptionStatus(TranscriptionStatus.PREPARING);
        const base64Audio = await audioBufferToWavBase64(audioBuffer);

        setStatusMessage("Transcribing audio with AI...");
        setTranscriptionStatus(TranscriptionStatus.TRANSCRIBING);

        const audioPart = {
            inlineData: {
                mimeType: 'audio/wav',
                data: base64Audio,
            },
        };
        const textPart = {
            text: 'Transcribe this audio. Your response should contain only the transcribed text and nothing else.'
        };

        const response = await ai.models.generateContent({
            // FIX: Use the recommended model 'gemini-2.5-flash' for text tasks.
            model: 'gemini-2.5-flash',
            contents: { parts: [audioPart, textPart] },
        });
        
        const transcription = response.text.trim();
        if (!transcription) {
            throw new Error("Transcription result was empty. The video may not contain speech.");
        }
        
        setStatusMessage("Audio transcribed successfully!");
        return transcription;

    } catch (error) {
        console.error("Failed to transcribe audio:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during transcription.";
        setStatusMessage(`Transcription failed: ${errorMessage}`);
        setTranscriptionStatus(TranscriptionStatus.ERROR);
        throw error;
    }
};

type GeneratedCue = {
    startTime: number;
    endTime: number;
    words: WordCue[];
};

export const generateCaptionsFromTranscription = async (
    transcription: string,
    duration: number,
    setStatusMessage: (message: string) => void
): Promise<GeneratedCue[]> => {
    if (!process.env.API_KEY) {
        throw new Error("API key not found.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    setStatusMessage("Generating synchronized captions with AI...");

    const prompt = `The following is a full transcription of a video that is ${duration.toFixed(2)} seconds long.
Your task is to segment this transcription into synchronized subtitle cues with word-level timestamps.
Provide the output as a valid JSON array of objects.
Each object in the array represents a sentence or a logical phrase and must have two properties:
1. "startTime": The time in seconds when the cue should appear (number).
2. "endTime": The time in seconds when the cue should disappear (number).
3. "words": An array of word objects. Each word object must have:
   - "word": The actual word (string).
   - "startTime": The time in seconds when the word starts (number).
   - "endTime": The time in seconds when the word ends (number).

Rules:
- The "startTime" of the first cue must be >= 0.
- The "endTime" of the last cue must be <= the video duration (${duration.toFixed(2)}).
- Cues and words should not have overlapping times.
- The word-level timestamps must be accurate.
- The entire transcription must be covered.

Transcription:
---
${transcription}
---
    `;
    
    try {
        const response = await ai.models.generateContent({
            // FIX: Use the recommended model 'gemini-2.5-flash' for text tasks.
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            startTime: { type: Type.NUMBER },
                            endTime: { type: Type.NUMBER },
                            words: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        word: { type: Type.STRING },
                                        startTime: { type: Type.NUMBER },
                                        endTime: { type: Type.NUMBER },
                                    },
                                    required: ["word", "startTime", "endTime"],
                                }
                            }
                        },
                        required: ["startTime", "endTime", "words"],
                    },
                },
            },
        });
        
        const jsonStr = response.text.trim();
        const cues = JSON.parse(jsonStr);
        return cues;
    } catch (error) {
        console.error("Failed to generate captions:", error);
        throw new Error("The AI failed to generate timed captions. The transcription might be empty or invalid.");
    }
};