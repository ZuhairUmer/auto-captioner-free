import React, { useState, useRef, useEffect } from 'react';
import { CaptionCue, SubtitleStyle, TranscriptionStatus, WordCue, GeneratedCue } from './types';
import { transcribeAudio, generateCaptionsFromTranscription } from './services/geminiService';
import { renderVideoWithCaptions, extractAudio, renderCaptionsOnGreenScreen } from './services/videoRenderer';
import { LoadingSpinner, UploadIcon, TimeIcon } from './components/icons';

const initialStyles: SubtitleStyle = {
  fontSize: 7, // percentage of video height
  positionY: 10, // percentage from bottom
  fontFamily: "'The Luckiest Guy', cursive",
  color: '#FFFFFF',
  backgroundColor: '#000000',
  highlightColor: '#FFFF00',
  showBackground: true,
  maxWordsPerCue: 7,
};

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [currentTime, setCurrentTime] = useState(0);

  const [status, setStatus] = useState<TranscriptionStatus>(TranscriptionStatus.IDLE);
  const [statusMessage, setStatusMessage] = useState<string>('Upload a video to start.');
  
  const [captions, setCaptions] = useState<CaptionCue[]>([]);
  const [originalCues, setOriginalCues] = useState<GeneratedCue[]>([]);
  const [styles, setStyles] = useState<SubtitleStyle>(initialStyles);
  
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputFilename, setOutputFilename] = useState<string>('');


  const isProcessing = ![
    TranscriptionStatus.IDLE,
    TranscriptionStatus.COMPLETED,
    TranscriptionStatus.ERROR,
  ].includes(status);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleTimeUpdate = () => {
      setCurrentTime(videoElement.currentTime);
    };

    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [videoUrl, outputUrl]);
  
  useEffect(() => {
    if (originalCues.length === 0) {
      setCaptions([]);
      return;
    }

    const allWords: WordCue[] = originalCues.flatMap(cue => cue.words);
    if (allWords.length === 0) {
      setCaptions([]);
      return;
    }
    
    const newCaptions: CaptionCue[] = [];
    let currentWords: WordCue[] = [];
    let cueId = 0;

    for (const word of allWords) {
      currentWords.push(word);
      if (currentWords.length >= styles.maxWordsPerCue) {
        newCaptions.push({
          id: cueId++,
          words: currentWords,
          startTime: currentWords[0].startTime,
          endTime: currentWords[currentWords.length - 1].endTime,
          text: currentWords.map(w => w.word).join(' '),
        });
        currentWords = [];
      }
    }

    if (currentWords.length > 0) {
      newCaptions.push({
        id: cueId++,
        words: currentWords,
        startTime: currentWords[0].startTime,
        endTime: currentWords[currentWords.length - 1].endTime,
        text: currentWords.map(w => w.word).join(' '),
      });
    }
    
    setCaptions(newCaptions);
  }, [originalCues, styles.maxWordsPerCue]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setOutputUrl(null);
      setStatus(TranscriptionStatus.IDLE);
      setStatusMessage('Video loaded. Ready to generate captions.');
      setCaptions([]);
      setOriginalCues([]);
    } else {
      setStatus(TranscriptionStatus.ERROR);
      setStatusMessage('Please select a valid video file.');
    }
  };
  
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
        setVideoDimensions({
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
        });
    }
  };

  const handleGenerate = async () => {
    if (!videoFile) return;

    setOutputUrl(null);
    setOriginalCues([]);

    try {
      setStatus(TranscriptionStatus.PREPARING);
      const audioBuffer = await extractAudio(videoFile, setStatusMessage);

      const transcription = await transcribeAudio(audioBuffer, setStatus, setStatusMessage);

      setStatus(TranscriptionStatus.TRANSCRIBING);
      setStatusMessage('Transcription complete. Generating timed captions...');

      const videoDuration = videoRef.current?.duration || 0;
      if (videoDuration === 0) {
        throw new Error("Could not determine video duration.");
      }
      const generatedCues = await generateCaptionsFromTranscription(transcription, videoDuration, setStatusMessage);

      setOriginalCues(generatedCues);
      setStatus(TranscriptionStatus.COMPLETED);
      setStatusMessage('Captions generated successfully! You can now edit them or render the video.');

    } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        setStatus(TranscriptionStatus.ERROR);
        setStatusMessage(`Error: ${message}`);
    }
  };
  
  const handleRender = async () => {
    if (!videoFile || captions.length === 0) return;
    
    setStatus(TranscriptionStatus.RENDERING);
    setStatusMessage('Preparing to render video...');
    setOutputFilename(`${videoFile.name.replace(/\.[^/.]+$/, "")}_captioned.webm`);
    
    try {
        const url = await renderVideoWithCaptions(videoFile, captions, styles, videoDimensions, setStatusMessage);
        setOutputUrl(url);
        setVideoUrl(null);
        setStatus(TranscriptionStatus.COMPLETED);
        setStatusMessage('Video rendered successfully! Click Download to save.');
    } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        setStatus(TranscriptionStatus.ERROR);
        setStatusMessage(`Render failed: ${message}`);
    }
  };
  
  const handleRenderGreenScreen = async () => {
    if (!videoFile || captions.length === 0) return;
    const duration = videoRef.current?.duration;
    if (!duration) {
        setStatus(TranscriptionStatus.ERROR);
        setStatusMessage('Could not determine video duration for green screen render.');
        return;
    }

    setStatus(TranscriptionStatus.RENDERING);
    setStatusMessage('Preparing to render green screen captions...');
    setOutputFilename(`${videoFile.name.replace(/\.[^/.]+$/, "")}_greenscreen_captions.webm`);

    try {
        const url = await renderCaptionsOnGreenScreen(captions, styles, videoDimensions, duration, setStatusMessage);
        setOutputUrl(url);
        setVideoUrl(null);
        setStatus(TranscriptionStatus.COMPLETED);
        setStatusMessage('Green screen video rendered successfully! Click Download to save.');
    } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        setStatus(TranscriptionStatus.ERROR);
        setStatusMessage(`Render failed: ${message}`);
    }
  };

  const activeCaption = captions.find(c => currentTime >= c.startTime && currentTime <= c.endTime);
  const videoAspectRatio = videoDimensions.width > 0 && videoDimensions.height > 0
    ? `${videoDimensions.width} / ${videoDimensions.height}`
    : '16 / 9';

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans flex flex-col">
      <header className="bg-gray-800 p-4 shadow-md">
        <h1 className="text-2xl font-bold text-center">AI Video Caption Generator</h1>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row p-4 gap-4">
        {/* Left/Main Panel */}
        <div className="flex-grow flex flex-col bg-gray-800 rounded-lg p-4 lg:w-2/3">
          {/* Video Player / Upload */}
          <div
            className="bg-black w-full rounded-lg flex items-center justify-center relative mb-4"
            style={{ aspectRatio: videoAspectRatio }}
          >
            {!videoUrl && !outputUrl ? (
              <label htmlFor="video-upload" className="cursor-pointer text-center p-8 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700 transition-colors">
                <UploadIcon className="w-16 h-16 mx-auto text-gray-500 mb-2" />
                <span className="font-semibold">Click to upload a video</span>
                <p className="text-sm text-gray-400">or drag and drop</p>
                <input id="video-upload" type="file" className="hidden" accept="video/*" onChange={handleFileChange} />
              </label>
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={outputUrl || videoUrl || ''}
                  controls
                  className="w-full h-full rounded-lg"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
                {activeCaption && !outputUrl && (
                   <div 
                     className="absolute text-center" 
                     style={{ 
                       bottom: `${styles.positionY}%`, 
                       left: '50%', 
                       transform: 'translateX(-50%)',
                       fontFamily: styles.fontFamily,
                       fontSize: `${styles.fontSize / 100 * (videoRef.current?.clientHeight || 0)}px`,
                       color: styles.color,
                     }}
                   >
                     <span style={{
                       backgroundColor: styles.showBackground ? styles.backgroundColor + 'B3' : 'transparent',
                       padding: '0.2em 0.4em',
                       borderRadius: '0.2em',
                       boxDecorationBreak: 'clone',
                       WebkitBoxDecorationBreak: 'clone',
                     }}>
                      {activeCaption.words.map((word, i) => (
                        <span key={i} style={{ color: currentTime >= word.startTime && currentTime <= word.endTime ? styles.highlightColor : styles.color }}>
                          {word.word}{' '}
                        </span>
                      ))}
                     </span>
                   </div>
                )}
              </>
            )}
          </div>

          {/* Status Bar */}
          <div className="bg-gray-700 p-3 rounded-lg flex items-center gap-3">
            {isProcessing && <LoadingSpinner />}
            <p className="flex-grow">{statusMessage}</p>
            {status === TranscriptionStatus.COMPLETED && outputUrl && (
              <a href={outputUrl} download={outputFilename} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                Download Video
              </a>
            )}
          </div>
        </div>

        {/* Right/Controls Panel */}
        <div className="lg:w-1/3 flex flex-col gap-4">
           {/* Actions */}
           <div className="bg-gray-800 p-4 rounded-lg">
             <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Actions</h2>
             <div className="flex flex-col gap-3">
               <button onClick={handleGenerate} disabled={!videoFile || isProcessing} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors w-full flex items-center justify-center gap-2">
                 <TimeIcon /> Generate Captions
               </button>
               <button onClick={handleRender} disabled={captions.length === 0 || isProcessing} className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors w-full">
                 Render Video
               </button>
                <button onClick={handleRenderGreenScreen} disabled={captions.length === 0 || isProcessing} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors w-full">
                 Export Green Screen
               </button>
             </div>
           </div>
          {/* Style Editor */}
          <div className="bg-gray-800 p-4 rounded-lg">
            <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Subtitle Style</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Font Family</label>
                <select value={styles.fontFamily} onChange={(e) => setStyles(s => ({ ...s, fontFamily: e.target.value }))} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2">
                  <option value="'The Luckiest Guy', cursive">The Luckiest Guy</option>
                  <option value="Impact, sans-serif">Impact</option>
                  <option>Arial</option>
                  <option>Verdana</option>
                  <option>Times New Roman</option>
                  <option>Courier New</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Font Color</label>
                  <input type="color" value={styles.color} onChange={(e) => setStyles(s => ({ ...s, color: e.target.value }))} className="w-full h-10 bg-gray-700 border-gray-600 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Highlight Color</label>
                  <input type="color" value={styles.highlightColor} onChange={(e) => setStyles(s => ({ ...s, highlightColor: e.target.value }))} className="w-full h-10 bg-gray-700 border-gray-600 rounded-lg" />
                </div>
              </div>
               <div>
                <label className="block text-sm font-medium mb-1">Words per Caption ({styles.maxWordsPerCue})</label>
                <input type="range" min="3" max="15" value={styles.maxWordsPerCue} onChange={(e) => setStyles(s => ({ ...s, maxWordsPerCue: Number(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Font Size ({styles.fontSize}%)</label>
                <input type="range" min="1" max="20" value={styles.fontSize} onChange={(e) => setStyles(s => ({ ...s, fontSize: Number(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Vertical Position ({styles.positionY}%)</label>
                <input type="range" min="1" max="90" value={styles.positionY} onChange={(e) => setStyles(s => ({ ...s, positionY: Number(e.target.value) }))} className="w-full" />
              </div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium">Show Background</label>
                <input type="checkbox" checked={styles.showBackground} onChange={(e) => setStyles(s => ({ ...s, showBackground: e.target.checked }))} className="w-5 h-5" />
              </div>
              {styles.showBackground && (
                <div>
                  <label className="block text-sm font-medium mb-1">Background Color</label>
                  <input type="color" value={styles.backgroundColor} onChange={(e) => setStyles(s => ({ ...s, backgroundColor: e.target.value }))} className="w-full h-10 bg-gray-700 border-gray-600 rounded-lg" />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
