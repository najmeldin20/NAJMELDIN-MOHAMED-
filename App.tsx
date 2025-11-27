import React, { useState, useRef, useEffect } from 'react';
import { Language, AppStatus } from './types';
import { generateTafsir, generateSpeech } from './services/geminiService';
import { BookOpenIcon, SpeakerIcon, PlayIcon, PauseIcon, SparklesIcon } from './components/Icons';
import Visualizer from './components/Visualizer';
import { quranSurahs, Surah } from './data/surahs';

type InputMode = 'selection' | 'text';

// Helper function to convert raw PCM data (Int16) to AudioBuffer
// Gemini 2.5 Flash TTS usually returns 24kHz Mono PCM
const pcmToAudioBuffer = (buffer: ArrayBuffer, ctx: AudioContext): AudioBuffer => {
  const pcmData = new Int16Array(buffer);
  const channels = 1;
  const sampleRate = 24000;
  
  const audioBuffer = ctx.createBuffer(channels, pcmData.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  for (let i = 0; i < pcmData.length; i++) {
    // Normalize 16-bit integer (-32768 to 32767) to float [-1, 1]
    channelData[i] = pcmData[i] / 32768.0;
  }
  
  return audioBuffer;
};

const App: React.FC = () => {
  const [inputMode, setInputMode] = useState<InputMode>('selection');
  
  // Selection Mode State
  const [selectedSurahId, setSelectedSurahId] = useState<number>(1);
  const [verseNumber, setVerseNumber] = useState<string>('');

  // Free Text Mode State
  const [query, setQuery] = useState('');

  const [language, setLanguage] = useState<Language>(Language.ARABIC);
  const [interpretation, setInterpretation] = useState<string>('');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  
  // State for playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  // Initialize Audio Context lazily
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
    }
    return audioContextRef.current;
  };

  const handleGenerate = async () => {
    let finalQuery = '';

    if (inputMode === 'selection') {
      const surah = quranSurahs.find(s => s.number === selectedSurahId);
      if (!surah) return;
      
      const surahName = language === Language.ARABIC ? surah.nameAr : surah.nameEn;
      const tafsirType = language === Language.ARABIC ? 'التفسير الميسر' : 'Tafsir Al-Muyassar';
      
      if (verseNumber.trim()) {
        finalQuery = language === Language.ARABIC
          ? `أريد تفسير الآية رقم ${verseNumber} من سورة ${surahName} من كتاب ${tafsirType}.`
          : `I want the interpretation of verse number ${verseNumber} from Surah ${surahName} using ${tafsirType}.`;
      } else {
        finalQuery = language === Language.ARABIC
          ? `أريد نبذة وتفسيراً عاماً لسورة ${surahName} من كتاب ${tafsirType}.`
          : `I want a summary and general interpretation of Surah ${surahName} using ${tafsirType}.`;
      }
    } else {
      finalQuery = query;
    }

    if (!finalQuery.trim()) return;
    
    // Stop any current audio
    stopAudio();
    setInterpretation('');
    setStatus(AppStatus.GENERATING_TEXT);
    setErrorMsg('');
    setAudioReady(false);

    try {
      const text = await generateTafsir(finalQuery, language);
      setInterpretation(text);
      setStatus(AppStatus.IDLE);
    } catch (err) {
      setStatus(AppStatus.ERROR);
      setErrorMsg(language === Language.ARABIC ? 'حدث خطأ أثناء التفسير. يرجى المحاولة مرة أخرى.' : 'An error occurred. Please try again.');
    }
  };

  const handleListen = async () => {
    if (!interpretation) return;

    if (audioReady && audioBufferRef.current) {
      // Audio already generated, just play
      playAudio(audioBufferRef.current);
      return;
    }

    setStatus(AppStatus.GENERATING_AUDIO);
    try {
      // Audio data is returned as ArrayBuffer containing raw PCM
      const audioData = await generateSpeech(interpretation, language);
      const ctx = getAudioContext();
      
      // Manually decode PCM data to AudioBuffer
      // Native ctx.decodeAudioData() fails because the response lacks WAV/MP3 headers
      const buffer = pcmToAudioBuffer(audioData, ctx);
      
      audioBufferRef.current = buffer;
      setAudioReady(true);
      
      playAudio(buffer);
    } catch (err) {
      console.error(err);
      setStatus(AppStatus.ERROR);
      setErrorMsg(language === Language.ARABIC ? 'حدث خطأ أثناء توليد الصوت.' : 'Error generating audio.');
    }
  };

  const playAudio = (buffer: AudioBuffer) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    
    // Connect to analyser then to destination
    if (analyserRef.current) {
      source.connect(analyserRef.current);
      analyserRef.current.connect(ctx.destination);
    } else {
      source.connect(ctx.destination);
    }

    source.onended = () => {
      setIsPlaying(false);
      setStatus(AppStatus.IDLE);
    };

    source.start(0);
    sourceNodeRef.current = source;
    setIsPlaying(true);
    setStatus(AppStatus.PLAYING);
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    if (status === AppStatus.PLAYING) setStatus(AppStatus.IDLE);
  };

  const toggleLanguage = () => {
    setLanguage(prev => prev === Language.ARABIC ? Language.ENGLISH : Language.ARABIC);
    setQuery('');
    setInterpretation('');
    stopAudio();
    setAudioReady(false);
    audioBufferRef.current = null;
  };

  const isRTL = language === Language.ARABIC;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className={`min-h-screen font-sans ${isRTL ? 'font-arabic' : ''} bg-islamic-cream text-islamic-dark transition-colors duration-300`}>
      
      {/* Header */}
      <header className="bg-islamic-dark text-islamic-cream p-6 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none" 
             style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4af37' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}>
        </div>
        
        <div className="max-w-4xl mx-auto flex justify-between items-center relative z-10">
          <div className="flex items-center gap-3">
            <BookOpenIcon className="w-8 h-8 text-islamic-gold" />
            <h1 className="text-2xl md:text-3xl font-bold tracking-wide">
              {language === Language.ARABIC ? 'التفسير الميسر الناطق' : 'Smart Facilitated Tafsir'}
            </h1>
          </div>
          <button 
            onClick={toggleLanguage}
            className="bg-islamic-base hover:bg-islamic-light text-white px-4 py-2 rounded-full text-sm transition-all border border-islamic-gold/30 shadow-md"
          >
            {language === Language.ARABIC ? 'English' : 'العربية'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 md:p-8 space-y-8">
        
        {/* Intro Section */}
        <section className="text-center space-y-2">
          <p className="text-islamic-base/80 text-lg">
            {language === Language.ARABIC 
              ? 'اختر السورة والآية للحصول على التفسير الميسر، أو اسأل سؤالاً دينياً.'
              : 'Select a Surah and Verse for Facilitated Tafsir, or ask a question.'}
          </p>
        </section>

        {/* Input Section */}
        <section className="bg-white rounded-2xl shadow-xl border border-islamic-gold/20 p-6 transition-all">
          
          {/* Mode Tabs */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              className={`pb-2 px-4 text-lg font-medium transition-colors relative ${inputMode === 'selection' ? 'text-islamic-base' : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => setInputMode('selection')}
            >
              {language === Language.ARABIC ? 'اختيار السورة' : 'Select Surah'}
              {inputMode === 'selection' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-islamic-gold rounded-t-full"></div>}
            </button>
            <button
              className={`pb-2 px-4 text-lg font-medium transition-colors relative ${inputMode === 'text' ? 'text-islamic-base' : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => setInputMode('text')}
            >
               {language === Language.ARABIC ? 'سؤال حر' : 'Free Question'}
               {inputMode === 'text' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-islamic-gold rounded-t-full"></div>}
            </button>
          </div>

          {inputMode === 'selection' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {language === Language.ARABIC ? 'السورة' : 'Surah'}
                </label>
                <select
                  value={selectedSurahId}
                  onChange={(e) => setSelectedSurahId(Number(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-islamic-gold/50 bg-white"
                >
                  {quranSurahs.map((surah) => (
                    <option key={surah.number} value={surah.number}>
                      {surah.number}. {language === Language.ARABIC ? surah.nameAr : surah.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {language === Language.ARABIC ? 'رقم الآية (اختياري)' : 'Verse No. (Optional)'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={verseNumber}
                  onChange={(e) => setVerseNumber(e.target.value)}
                  placeholder="1..."
                  className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-islamic-gold/50"
                />
              </div>
            </div>
          ) : (
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={language === Language.ARABIC ? 'مثال: ما هو فضل صلاة الفجر؟' : 'Example: What is the virtue of Fajr prayer?'}
              className="w-full min-h-[120px] p-4 text-lg outline-none resize-none placeholder-gray-400 bg-transparent border border-gray-300 rounded-xl focus:ring-2 focus:ring-islamic-gold/50"
            />
          )}

          <div className="flex justify-end mt-6">
            <button
              onClick={handleGenerate}
              disabled={status === AppStatus.GENERATING_TEXT || (inputMode === 'text' && !query.trim())}
              className="bg-islamic-gold hover:bg-yellow-500 text-islamic-dark font-bold py-3 px-8 rounded-xl flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-md w-full md:w-auto justify-center"
            >
              {status === AppStatus.GENERATING_TEXT ? (
                <>
                  <div className="animate-spin h-5 w-5 border-2 border-islamic-dark border-t-transparent rounded-full"></div>
                  {language === Language.ARABIC ? 'جاري التفسير...' : 'Interpreting...'}
                </>
              ) : (
                <>
                  <SparklesIcon className="w-5 h-5" />
                  {language === Language.ARABIC ? 'تفسير' : 'Interpret'}
                </>
              )}
            </button>
          </div>
        </section>

        {/* Error Display */}
        {status === AppStatus.ERROR && errorMsg && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 text-center">
            {errorMsg}
          </div>
        )}

        {/* Result Section */}
        {interpretation && (
          <section className="bg-white rounded-2xl shadow-xl border border-islamic-gold/20 overflow-hidden animate-fade-in-up">
            <div className="bg-islamic-base/5 p-4 border-b border-islamic-gold/10 flex justify-between items-center">
              <h2 className="text-xl font-bold text-islamic-base flex items-center gap-2">
                <BookOpenIcon className="w-5 h-5" />
                {language === Language.ARABIC ? 'التفسير الميسر' : 'Interpretation'}
              </h2>
              
              {/* Audio Controls */}
              <div className="flex gap-2">
                 {isPlaying ? (
                    <button 
                      onClick={stopAudio}
                      className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg transition-colors text-sm font-semibold"
                    >
                      <PauseIcon className="w-5 h-5" />
                      {language === Language.ARABIC ? 'إيقاف' : 'Stop'}
                    </button>
                 ) : (
                    <button 
                      onClick={handleListen}
                      disabled={status === AppStatus.GENERATING_AUDIO}
                      className="flex items-center gap-2 bg-islamic-dark hover:bg-islamic-base text-white px-4 py-2 rounded-lg transition-colors text-sm font-semibold disabled:opacity-70"
                    >
                      {status === AppStatus.GENERATING_AUDIO ? (
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                      ) : (
                         <SpeakerIcon className="w-5 h-5" />
                      )}
                      {language === Language.ARABIC ? 'استماع' : 'Listen'}
                    </button>
                 )}
              </div>
            </div>
            
            <div className="p-6 md:p-8">
              {/* Visualizer when playing */}
              <Visualizer isPlaying={isPlaying} analyser={analyserRef.current} />

              <div className={`prose max-w-none text-lg leading-relaxed ${isPlaying ? 'opacity-80' : 'opacity-100'} transition-opacity mt-4 text-gray-800`}>
                 <p className="whitespace-pre-line">{interpretation}</p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 py-8 text-center text-islamic-base/60 text-sm">
        <p>
          {language === Language.ARABIC 
           ? 'مدعوم بواسطة Google Gemini. هذا التطبيق لأغراض تعليمية.'
           : 'Powered by Google Gemini. This app is for educational purposes.'}
        </p>
      </footer>
      
      <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default App;