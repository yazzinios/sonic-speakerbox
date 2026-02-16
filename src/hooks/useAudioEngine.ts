import { useRef, useState, useCallback, useEffect } from 'react';

export interface EQState {
  low: number;   // -12 to 12 dB
  mid: number;
  high: number;
}

export interface DeckState {
  fileName: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  eq: EQState;
  loopStart: number | null;
  loopEnd: number | null;
  loopActive: boolean;
  youtubeUrl: string;
}

const INITIAL_DECK: DeckState = {
  fileName: '',
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  speed: 1,
  eq: { low: 0, mid: 0, high: 0 },
  loopStart: null,
  loopEnd: null,
  loopActive: false,
  youtubeUrl: '',
};

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioElsRef = useRef<Record<string, HTMLAudioElement>>({});
  const sourcesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const gainsRef = useRef<Record<string, GainNode>>({});
  const analysersRef = useRef<Record<string, AnalyserNode>>({});
  const eqNodesRef = useRef<Record<string, { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode }>>({});
  const micGainRef = useRef<GainNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const customJingleRef = useRef<ArrayBuffer | null>(null);

  const [deckA, setDeckA] = useState<DeckState>({ ...INITIAL_DECK });
  const [deckB, setDeckB] = useState<DeckState>({ ...INITIAL_DECK });
  const [crossfader, setCrossfaderState] = useState(0.5);
  const [micActive, setMicActive] = useState(false);
  const [jinglePlaying, setJinglePlaying] = useState(false);
  const [micDuck, setMicDuck] = useState(1);

  const getCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const master = ctx.createGain();
    masterRef.current = master;
    const streamDest = ctx.createMediaStreamDestination();
    streamDestRef.current = streamDest;
    master.connect(ctx.destination);
    master.connect(streamDest);

    for (const id of ['A', 'B']) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audioElsRef.current[id] = audio;

      const source = ctx.createMediaElementSource(audio);
      sourcesRef.current[id] = source;

      // EQ chain: source -> low -> mid -> high -> gain -> analyser -> master
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 320;
      low.gain.value = 0;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 0.5;
      mid.gain.value = 0;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 3200;
      high.gain.value = 0;

      eqNodesRef.current[id] = { low, mid, high };

      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      gainsRef.current[id] = gain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analysersRef.current[id] = analyser;

      source.connect(low);
      low.connect(mid);
      mid.connect(high);
      high.connect(gain);
      gain.connect(analyser);
      analyser.connect(master);
    }

    const micGain = ctx.createGain();
    micGain.gain.value = 0;
    micGain.connect(master);
    micGainRef.current = micGain;

    return ctx;
  }, []);

  // Time update loop + loop enforcement
  useEffect(() => {
    const update = () => {
      for (const [id, setter] of [['A', setDeckA], ['B', setDeckB]] as const) {
        const audio = audioElsRef.current[id];
        if (audio?.duration) {
          setter(prev => {
            // Loop enforcement
            if (prev.loopActive && prev.loopStart !== null && prev.loopEnd !== null) {
              if (audio.currentTime >= prev.loopEnd) {
                audio.currentTime = prev.loopStart;
              }
            }
            return {
              ...prev,
              currentTime: audio.currentTime,
              duration: audio.duration,
              isPlaying: !audio.paused,
            };
          });
        }
      }
      animFrameRef.current = requestAnimationFrame(update);
    };
    animFrameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // Update gains on crossfader/volume/duck change
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const gainA = gainsRef.current['A'];
    const gainB = gainsRef.current['B'];
    const t = ctx.currentTime;
    if (gainA) gainA.gain.setTargetAtTime(
      Math.cos(crossfader * Math.PI / 2) * deckA.volume * micDuck, t, 0.05
    );
    if (gainB) gainB.gain.setTargetAtTime(
      Math.sin(crossfader * Math.PI / 2) * deckB.volume * micDuck, t, 0.05
    );
  }, [crossfader, deckA.volume, deckB.volume, micDuck]);

  const loadTrack = useCallback((deck: 'A' | 'B', file: File) => {
    getCtx();
    const audio = audioElsRef.current[deck];
    if (!audio) return;
    audio.src = URL.createObjectURL(file);
    audio.load();
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, fileName: file.name, currentTime: 0, duration: 0, isPlaying: false, loopStart: null, loopEnd: null, loopActive: false }));
  }, [getCtx]);

  const play = useCallback((deck: 'A' | 'B') => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    audioElsRef.current[deck]?.play();
  }, [getCtx]);

  const pause = useCallback((deck: 'A' | 'B') => {
    audioElsRef.current[deck]?.pause();
  }, []);

  const stop = useCallback((deck: 'A' | 'B') => {
    const audio = audioElsRef.current[deck];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const setVolume = useCallback((deck: 'A' | 'B', vol: number) => {
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, volume: vol }));
  }, []);

  const setCrossfader = useCallback((val: number) => {
    setCrossfaderState(val);
  }, []);

  const setEQ = useCallback((deck: 'A' | 'B', band: 'low' | 'mid' | 'high', value: number) => {
    const eq = eqNodesRef.current[deck];
    if (eq) {
      eq[band].gain.value = value;
    }
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, eq: { ...prev.eq, [band]: value } }));
  }, []);

  const setSpeed = useCallback((deck: 'A' | 'B', speed: number) => {
    const audio = audioElsRef.current[deck];
    if (audio) {
      audio.playbackRate = speed;
    }
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, speed }));
  }, []);

  const setLoopStart = useCallback((deck: 'A' | 'B') => {
    const audio = audioElsRef.current[deck];
    if (!audio) return;
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, loopStart: audio.currentTime }));
  }, []);

  const setLoopEnd = useCallback((deck: 'A' | 'B') => {
    const audio = audioElsRef.current[deck];
    if (!audio) return;
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, loopEnd: audio.currentTime, loopActive: prev.loopStart !== null }));
  }, []);

  const toggleLoop = useCallback((deck: 'A' | 'B') => {
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, loopActive: !prev.loopActive }));
  }, []);

  const clearLoop = useCallback((deck: 'A' | 'B') => {
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, loopStart: null, loopEnd: null, loopActive: false }));
  }, []);

  const setYoutubeUrl = useCallback((deck: 'A' | 'B', url: string) => {
    const setter = deck === 'A' ? setDeckA : setDeckB;
    setter(prev => ({ ...prev, youtubeUrl: url }));
  }, []);

  // YouTube iframe control via postMessage
  const youtubePlay = useCallback((deck: 'A' | 'B') => {
    const iframe = document.getElementById(`yt-player-${deck}`) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      const setter = deck === 'A' ? setDeckA : setDeckB;
      setter(prev => ({ ...prev, fileName: prev.youtubeUrl ? `YouTube (Deck ${deck})` : prev.fileName, isPlaying: true }));
    }
  }, []);

  const youtubeStop = useCallback((deck: 'A' | 'B') => {
    const iframe = document.getElementById(`yt-player-${deck}`) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"stopVideo","args":""}', '*');
      const setter = deck === 'A' ? setDeckA : setDeckB;
      setter(prev => ({ ...prev, isPlaying: false }));
    }
  }, []);

  const setCustomJingle = useCallback((buffer: ArrayBuffer) => {
    customJingleRef.current = buffer;
  }, []);

  const playJingle = useCallback((): Promise<void> => {
    const ctx = getCtx();
    return new Promise(async (resolve) => {
      setJinglePlaying(true);
      const master = masterRef.current!;

      if (customJingleRef.current) {
        // Play custom jingle from uploaded file
        const audioBuffer = await ctx.decodeAudioData(customJingleRef.current.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        source.connect(g);
        g.connect(master);
        source.start();
        source.onended = () => {
          setJinglePlaying(false);
          resolve();
        };
      } else {
        // Default tan-tan-tan jingle
        const notes = [660, 660, 880];
        const noteLen = 0.15;
        const gap = 0.12;
        const now = ctx.currentTime;

        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.value = freq;
          osc.type = 'sine';
          g.gain.value = 0.3;
          osc.connect(g);
          g.connect(master);
          const t = now + i * (noteLen + gap);
          osc.start(t);
          osc.stop(t + noteLen);
          g.gain.setValueAtTime(0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + noteLen);
        });

        setTimeout(() => {
          setJinglePlaying(false);
          resolve();
        }, notes.length * (noteLen + gap) * 1000 + 100);
      }
    });
  }, [getCtx]);

  const startMic = useCallback(async () => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    await playJingle();
    setMicDuck(0.2);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    const source = ctx.createMediaStreamSource(stream);
    micSourceRef.current = source;
    source.connect(micGainRef.current!);
    micGainRef.current!.gain.setValueAtTime(1, ctx.currentTime);
    setMicActive(true);
  }, [getCtx, playJingle]);

  const stopMic = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    if (micGainRef.current) {
      micGainRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
    setMicDuck(1);

    setTimeout(() => {
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micSourceRef.current?.disconnect();
      micSourceRef.current = null;
      micStreamRef.current = null;
      setMicActive(false);
    }, 300);
  }, []);

  // Play an announcement MP3 through master output
  const playAnnouncement = useCallback(async (file: File, duckMusic: boolean = true) => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    
    if (duckMusic) setMicDuck(0.15);
    
    const buffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const g = ctx.createGain();
    g.gain.value = 0.8;
    source.connect(g);
    g.connect(masterRef.current!);
    source.start();
    
    return new Promise<void>((resolve) => {
      source.onended = () => {
        if (duckMusic) setMicDuck(1);
        resolve();
      };
    });
  }, [getCtx]);

  const getAnalyser = useCallback((deck: 'A' | 'B'): AnalyserNode | null => {
    return analysersRef.current[deck] || null;
  }, []);

  const getOutputStream = useCallback((): MediaStream | null => {
    getCtx();
    return streamDestRef.current?.stream || null;
  }, [getCtx]);

  const duckStart = useCallback(() => setMicDuck(0.15), []);
  const duckEnd = useCallback(() => setMicDuck(1), []);

  return {
    deckA, deckB, crossfader, micActive, jinglePlaying,
    loadTrack, play, pause, stop, setVolume, setCrossfader,
    setEQ, setSpeed, setLoopStart, setLoopEnd, toggleLoop, clearLoop,
    setYoutubeUrl, youtubePlay, youtubeStop, setCustomJingle, playAnnouncement,
    startMic, stopMic, getAnalyser, getOutputStream, duckStart, duckEnd,
  };
}
