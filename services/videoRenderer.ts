import { CaptionCue, SubtitleStyle } from '../types';

/**
 * Extracts an AudioBuffer from a video file and resamples it to 16kHz mono for AI transcription.
 * This is a browser-native approach that does not rely on FFmpeg.
 */
export const extractAudio = async (
    videoFile: File,
    setProgress: (message: string) => void
): Promise<AudioBuffer> => {
    try {
        setProgress('Preparing audio for decoding...');
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await videoFile.arrayBuffer();

        setProgress('Decoding audio track...');
        const originalBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const targetSampleRate = 16000;
        if (originalBuffer.sampleRate === targetSampleRate && originalBuffer.numberOfChannels === 1) {
            setProgress('Audio is already in the correct format.');
            return originalBuffer;
        }

        setProgress('Resampling audio for AI compatibility...');
        const duration = originalBuffer.duration;
        const offlineContext = new OfflineAudioContext(1, duration * targetSampleRate, targetSampleRate);
        
        const source = offlineContext.createBufferSource();
        source.buffer = originalBuffer;
        source.connect(offlineContext.destination);
        source.start();

        const resampledBuffer = await offlineContext.startRendering();
        setProgress('Audio ready for transcription.');
        return resampledBuffer;
    } catch (error) {
        console.error("Error extracting audio:", error);
        throw new Error("Failed to process audio from the video file. It may be corrupt or in an unsupported format.");
    }
};


/**
 * Renders a video with burned-in captions using the Canvas and MediaRecorder APIs.
 * This is a browser-native approach that does not rely on FFmpeg.
 */
export const renderVideoWithCaptions = async (
    videoFile: File,
    captions: CaptionCue[],
    styles: SubtitleStyle,
    videoDimensions: { width: number, height: number },
    setProgress: (message: string) => void
): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        const { width, height } = videoDimensions;
        
        // 1. Setup Canvas for rendering
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false }); // alpha: false for performance
        if (!ctx) return reject(new Error('Could not create canvas context.'));

        // 2. Setup video element for frame-by-frame drawing
        const videoElement = document.createElement('video');
        videoElement.src = URL.createObjectURL(videoFile);
        videoElement.muted = true;
        
        // 3. Setup audio element to get the audio track
        const audioElement = document.createElement('audio');
        audioElement.src = URL.createObjectURL(videoFile);

        // 4. Setup MediaRecorder to record the output
        const chunks: Blob[] = [];
        const canvasStream = canvas.captureStream(30); // Capture at 30 FPS

        // Get audio track
        const audioContext = new AudioContext();
        const audioSource = audioContext.createMediaElementSource(audioElement);
        const audioDestination = audioContext.createMediaStreamDestination();
        audioSource.connect(audioDestination);
        const [audioTrack] = audioDestination.stream.getAudioTracks();
        
        // Combine video and audio tracks
        const combinedStream = new MediaStream([canvasStream.getVideoTracks()[0], audioTrack]);
        
        // Use webm as it's generally well-supported for recording
        const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9' }); 

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            resolve(url);
            // Cleanup
            URL.revokeObjectURL(videoElement.src);
            URL.revokeObjectURL(audioElement.src);
            audioContext.close();
        };
        
        recorder.onerror = (e) => reject(new Error(`MediaRecorder error: ${e.type}`));

        // 5. The Rendering Loop
        const renderLoop = () => {
            if (videoElement.paused || videoElement.ended) {
                return; // Stop the loop if video is not playing
            }
            // Draw video frame
            ctx.drawImage(videoElement, 0, 0, width, height);

            // Draw captions
            const activeCaption = captions.find(c => videoElement.currentTime >= c.startTime && videoElement.currentTime <= c.endTime);
            if (activeCaption) {
                drawCaption(ctx, activeCaption, videoElement.currentTime, styles, height);
            }
            
            // Report progress
            const progress = (videoElement.currentTime / videoElement.duration) * 100;
            setProgress(`Rendering video... ${Math.round(progress)}%`);

            // Request next frame
            requestAnimationFrame(renderLoop);
        };
        
        videoElement.onended = () => {
            if (recorder.state === 'recording') {
                recorder.stop();
            }
        };

        // Start everything once the video can play
        videoElement.oncanplay = () => {
            videoElement.play();
            audioElement.play();
            if (recorder.state === 'inactive') {
                recorder.start();
            }
            requestAnimationFrame(renderLoop);
        };

        videoElement.onerror = () => reject(new Error("Failed to load video for rendering."));
        audioElement.onerror = () => reject(new Error("Failed to load audio for rendering."));

        // Load the video metadata to trigger oncanplay
        videoElement.load();
        audioElement.load();
    });
};


/**
 * Helper function to draw a single caption on the canvas.
 */
const drawCaption = (
    ctx: CanvasRenderingContext2D,
    caption: CaptionCue,
    currentTime: number,
    styles: SubtitleStyle,
    videoHeight: number,
) => {
    // Save context state
    ctx.save();

    // Style setup
    const fontSize = (styles.fontSize / 100) * videoHeight;
    ctx.font = `${fontSize}px ${styles.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Position setup
    const x = ctx.canvas.width / 2;
    const y = ctx.canvas.height - ( (styles.positionY / 100) * ctx.canvas.height );

    const fullText = caption.words.map(w => w.word).join(' ');
    
    // Simple line wrapping
    const maxWidth = ctx.canvas.width * 0.9;
    const words = fullText.split(' ');
    let line = '';
    const lines = [];
    for (const word of words) {
        const testLine = line + word + ' ';
        if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
            lines.push(line.trim());
            line = word + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    
    const lineHeight = fontSize * 1.2;

    // Draw background for each line
    if (styles.showBackground) {
        ctx.fillStyle = styles.backgroundColor + 'B3'; // Add 70% alpha
        const padding = fontSize * 0.2;
        for (let i = 0; i < lines.length; i++) {
            const textWidth = ctx.measureText(lines[i]).width;
            const bgX = x - textWidth / 2 - padding;
            const bgY = y - (lines.length - i) * lineHeight;
            const bgWidth = textWidth + (padding * 2);
            const bgHeight = lineHeight;
            ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
        }
    }
    
    // Draw text with word-level highlighting
    let wordIdxOffset = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        const lineY = y - (lines.length - 1 - i) * lineHeight + (lineHeight - fontSize) / 2;
        const lineWords = lineText.split(' ');
        
        const totalLineWidth = ctx.measureText(lineText).width;
        let currentX = x - totalLineWidth / 2;

        for (const wordStr of lineWords) {
            const word = caption.words[wordIdxOffset];
            
            if (!word) continue;

            const isHighlighted = styles.enableHighlight && currentTime >= word.startTime && currentTime <= word.endTime;
            ctx.fillStyle = isHighlighted ? styles.highlightColor : styles.color;
            
            const wordWidth = ctx.measureText(wordStr).width;
            // Center each word in its measured space
            ctx.fillText(wordStr, currentX + wordWidth / 2, lineY);
            currentX += wordWidth + ctx.measureText(' ').width; // Add space width
            wordIdxOffset++;
        }
    }

    // Restore context state
    ctx.restore();
};