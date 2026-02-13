import { useRef, useState, useCallback, useEffect } from 'react';

export interface DeckState {
  fileName: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

const INITIAL_DECK: DeckState = {
  fileName: '',
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
};

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioElsRef = useRef<Record<string, HTMLAudioElement>>({});
  const sourcesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const gainsRef = useRef<Record<string, GainNode>>({});
  const analysersRef = useRef<Record<string, AnalyserNode>>({});
  const micGainRef = useRef<GainNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number>(0);

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
      audioElsRef.current[id] = audio;

      const source = ctx.createMediaElementSource(audio);
      sourcesRef.current[id] = source;

      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      gainsRef.current[id] = gain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analysersRef.current[id] = analyser;

      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(master);
    }

    const micGain = ctx.createGain();
    micGain.gain.value = 0;
    micGain.connect(master);
    micGainRef.current = micGain;

    return ctx;
  }, []);

  // Time update loop
  useEffect(() => {
    const update = () => {
      const audioA = audioElsRef.current['A'];
      const audioB = audioElsRef.current['B'];
      if (audioA?.duration) {
        setDeckA(prev => ({
          ...prev,
          currentTime: audioA.currentTime,
          duration: audioA.duration,
          isPlaying: !audioA.paused,
        }));
      }
      if (audioB?.duration) {
        setDeckB(prev => ({
          ...prev,
          currentTime: audioB.currentTime,
          duration: audioB.duration,
          isPlaying: !audioB.paused,
        }));
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
    setter(prev => ({ ...prev, fileName: file.name, currentTime: 0, duration: 0, isPlaying: false }));
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

  const playJingle = useCallback((): Promise<void> => {
    const ctx = getCtx();
    return new Promise((resolve) => {
      setJinglePlaying(true);
      const master = masterRef.current!;
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

  const getAnalyser = useCallback((deck: 'A' | 'B'): AnalyserNode | null => {
    return analysersRef.current[deck] || null;
  }, []);

  const getOutputStream = useCallback((): MediaStream | null => {
    getCtx();
    return streamDestRef.current?.stream || null;
  }, [getCtx]);

  return {
    deckA, deckB, crossfader, micActive, jinglePlaying,
    loadTrack, play, pause, stop, setVolume, setCrossfader,
    startMic, stopMic, getAnalyser, getOutputStream,
  };
}
