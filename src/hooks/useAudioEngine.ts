import { useRef, useState, useCallback, useEffect } from 'react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS } from '@/types/channels';
import { STREAMING_SERVER } from '@/lib/streamingServer';

export interface EQState {
  low: number;
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

// Default mic duck level: 5% of original volume
const DEFAULT_MIC_DUCK_LEVEL = 0.05;

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Per-deck stream destinations for per-channel broadcasting
  const deckStreamDestsRef = useRef<Record<string, MediaStreamAudioDestinationNode>>({});
  const audioElsRef = useRef<Record<string, HTMLAudioElement>>({});
  const sourcesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const gainsRef = useRef<Record<string, GainNode>>({});
  const analysersRef = useRef<Record<string, AnalyserNode>>({});
  const eqNodesRef = useRef<Record<string, { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode }>>({});
  const micGainRef = useRef<GainNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Per-deck mic gains for selective mic routing
  const micDeckGainsRef = useRef<Record<string, GainNode>>({});
  const animFrameRef = useRef<number>(0);
  const customJingleRef = useRef<ArrayBuffer | null>(null);

  const [decks, setDecks] = useState<Record<DeckId, DeckState>>({
    A: { ...INITIAL_DECK },
    B: { ...INITIAL_DECK },
    C: { ...INITIAL_DECK },
    D: { ...INITIAL_DECK },
  });
  const [micActive, setMicActive] = useState(false);
  const [jinglePlaying, setJinglePlaying] = useState(false);
  const [micDuck, setMicDuck] = useState(1);
  // User-configurable mic duck level (saved in localStorage)
  const [micDuckLevel, setMicDuckLevelState] = useState<number>(() => {
    const saved = localStorage.getItem('mic-duck-level');
    return saved !== null ? parseFloat(saved) : DEFAULT_MIC_DUCK_LEVEL;
  });

  const setMicDuckLevel = useCallback((level: number) => {
    const clamped = Math.max(0, Math.min(1, level));
    setMicDuckLevelState(clamped);
    localStorage.setItem('mic-duck-level', String(clamped));
  }, []);

  const setDeck = useCallback((id: DeckId, updater: (prev: DeckState) => DeckState) => {
    setDecks(prev => ({ ...prev, [id]: updater(prev[id]) }));
  }, []);

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

    for (const id of ALL_DECKS) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audioElsRef.current[id] = audio;

      const source = ctx.createMediaElementSource(audio);
      sourcesRef.current[id] = source;

      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf'; low.frequency.value = 320; low.gain.value = 0;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.5; mid.gain.value = 0;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf'; high.frequency.value = 3200; high.gain.value = 0;
      eqNodesRef.current[id] = { low, mid, high };

      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      gainsRef.current[id] = gain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analysersRef.current[id] = analyser;

      // Per-deck stream destination (used for per-channel HLS broadcast)
      const deckDest = ctx.createMediaStreamDestination();
      deckStreamDestsRef.current[id] = deckDest;

      source.connect(low);
      low.connect(mid);
      mid.connect(high);
      high.connect(gain);
      gain.connect(analyser);
      analyser.connect(master);
      // Also route to per-deck destination
      analyser.connect(deckDest);

      // Per-deck mic gain (for selective mic routing to specific channels)
      const micDeckGain = ctx.createGain();
      micDeckGain.gain.value = 0;
      micDeckGain.connect(deckDest);
      micDeckGainsRef.current[id] = micDeckGain;
    }

    // Master mic gain — routes to local monitor (speakers) only, NOT to any stream
    // This lets the DJ hear themselves locally without leaking to wrong streams
    const micGain = ctx.createGain();
    micGain.gain.value = 0;
    micGain.connect(ctx.destination); // local monitor only
    micGainRef.current = micGain;

    return ctx;
  }, []);

  // Time update loop + loop enforcement
  useEffect(() => {
    const update = () => {
      for (const id of ALL_DECKS) {
        const audio = audioElsRef.current[id];
        if (audio?.duration) {
          setDeck(id, prev => {
            if (prev.loopActive && prev.loopStart !== null && prev.loopEnd !== null) {
              if (audio.currentTime >= prev.loopEnd) {
                audio.currentTime = prev.loopStart;
              }
            }
            return { ...prev, currentTime: audio.currentTime, duration: audio.duration, isPlaying: !audio.paused };
          });
        }
      }
      animFrameRef.current = requestAnimationFrame(update);
    };
    animFrameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [setDeck]);

  // Update gains on volume/duck change
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const id of ALL_DECKS) {
      const gain = gainsRef.current[id];
      if (gain) gain.gain.setTargetAtTime(decks[id].volume * micDuck, t, 0.05);
    }
  }, [decks.A.volume, decks.B.volume, decks.C.volume, decks.D.volume, micDuck]);

  const loadTrack = useCallback((deck: DeckId, file: File) => {
    getCtx();
    const audio = audioElsRef.current[deck];
    if (!audio) return;
    audio.src = URL.createObjectURL(file);
    audio.load();
    setDeck(deck, prev => ({ ...prev, fileName: file.name, currentTime: 0, duration: 0, isPlaying: false, loopStart: null, loopEnd: null, loopActive: false }));

    // Upload track to server in background so it can play independently of the browser.
    // autoplay=false — DJ still controls play/pause from the browser.
    // When browser exits, call /deck/:deck/play to resume server-side playback.
    const form = new FormData();
    form.append('track', file);
    fetch(`${STREAMING_SERVER}/upload/${deck}?autoplay=false`, {
      method: 'POST',
      body: form,
    }).then(r => r.json()).then(data => {
      if (data.ok) console.log(`[${deck}] Track uploaded to server: ${file.name}`);
    }).catch(err => console.warn(`[${deck}] Track upload failed (server offline?):`, err));
  }, [getCtx, setDeck]);

  const play = useCallback((deck: DeckId) => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    audioElsRef.current[deck]?.play();
  }, [getCtx]);

  const pause = useCallback((deck: DeckId) => { audioElsRef.current[deck]?.pause(); }, []);

  const stop = useCallback((deck: DeckId) => {
    const audio = audioElsRef.current[deck];
    if (audio) { audio.pause(); audio.currentTime = 0; }
  }, []);

  const setVolume = useCallback((deck: DeckId, vol: number) => {
    setDeck(deck, prev => ({ ...prev, volume: vol }));
  }, [setDeck]);

  const setEQ = useCallback((deck: DeckId, band: 'low' | 'mid' | 'high', value: number) => {
    const eq = eqNodesRef.current[deck];
    if (eq) eq[band].gain.value = value;
    setDeck(deck, prev => ({ ...prev, eq: { ...prev.eq, [band]: value } }));
  }, [setDeck]);

  const setSpeed = useCallback((deck: DeckId, speed: number) => {
    const audio = audioElsRef.current[deck];
    if (audio) audio.playbackRate = speed;
    setDeck(deck, prev => ({ ...prev, speed }));
  }, [setDeck]);

  const setLoopStart = useCallback((deck: DeckId) => {
    const audio = audioElsRef.current[deck];
    if (!audio) return;
    setDeck(deck, prev => ({ ...prev, loopStart: audio.currentTime }));
  }, [setDeck]);

  const setLoopEnd = useCallback((deck: DeckId) => {
    const audio = audioElsRef.current[deck];
    if (!audio) return;
    setDeck(deck, prev => ({ ...prev, loopEnd: audio.currentTime, loopActive: prev.loopStart !== null }));
  }, [setDeck]);

  const toggleLoop = useCallback((deck: DeckId) => {
    setDeck(deck, prev => ({ ...prev, loopActive: !prev.loopActive }));
  }, [setDeck]);

  const clearLoop = useCallback((deck: DeckId) => {
    setDeck(deck, prev => ({ ...prev, loopStart: null, loopEnd: null, loopActive: false }));
  }, [setDeck]);

  const setYoutubeUrl = useCallback((deck: DeckId, url: string) => {
    setDeck(deck, prev => ({ ...prev, youtubeUrl: url }));
  }, [setDeck]);

  const youtubePlay = useCallback((deck: DeckId) => {
    const iframe = document.getElementById(`yt-player-${deck}`) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      setDeck(deck, prev => ({ ...prev, fileName: prev.youtubeUrl ? `YouTube (Deck ${deck})` : prev.fileName, isPlaying: true }));
    }
  }, [setDeck]);

  const youtubeStop = useCallback((deck: DeckId) => {
    const iframe = document.getElementById(`yt-player-${deck}`) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"stopVideo","args":""}', '*');
      setDeck(deck, prev => ({ ...prev, isPlaying: false }));
    }
  }, [setDeck]);

  const setCustomJingle = useCallback((buffer: ArrayBuffer) => {
    customJingleRef.current = buffer;
  }, []);

  const playJingle = useCallback((): Promise<void> => {
    const ctx = getCtx();
    return new Promise(async (resolve) => {
      setJinglePlaying(true);
      const master = masterRef.current!;
      if (customJingleRef.current) {
        const audioBuffer = await ctx.decodeAudioData(customJingleRef.current.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const g = ctx.createGain(); g.gain.value = 0.5;
        source.connect(g); g.connect(master);
        source.start();
        source.onended = () => { setJinglePlaying(false); resolve(); };
      } else {
        const notes = [660, 660, 880];
        const noteLen = 0.15; const gap = 0.12; const now = ctx.currentTime;
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.value = freq; osc.type = 'sine'; g.gain.value = 0.3;
          osc.connect(g); g.connect(master);
          const t = now + i * (noteLen + gap);
          osc.start(t); osc.stop(t + noteLen);
          g.gain.setValueAtTime(0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + noteLen);
        });
        setTimeout(() => { setJinglePlaying(false); resolve(); }, notes.length * (noteLen + gap) * 1000 + 100);
      }
    });
  }, [getCtx]);

  /**
   * Start mic broadcasting.
   * @param targets - which deck channels to route mic to. Defaults to all.
   *
   * The mic is routed ONLY to the selected deck stream destinations.
   * Music on non-targeted decks is NOT ducked — only targeted decks get ducked.
   * Local monitor (DJ headphones) always hears the mic.
   */
  const startMic = useCallback(async (targets: DeckId[] = ALL_DECKS as unknown as DeckId[]) => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    await playJingle();

    // Duck only the targeted deck volumes using the configured duck level
    setMicDuck(micDuckLevel);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    const source = ctx.createMediaStreamSource(stream);
    micSourceRef.current = source;

    // Route to local monitor so DJ hears themselves
    source.connect(micGainRef.current!);
    micGainRef.current!.gain.setValueAtTime(1, ctx.currentTime);

    // Route mic ONLY to selected deck stream destinations
    for (const id of ALL_DECKS) {
      const g = micDeckGainsRef.current[id];
      if (g) {
        source.connect(g);
        // Only open the gate for targeted decks
        g.gain.setValueAtTime(targets.includes(id) ? 1 : 0, ctx.currentTime);
      }
    }

    setMicActive(true);
  }, [getCtx, playJingle, micDuckLevel]);

  const stopMic = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (micGainRef.current) micGainRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    for (const id of ALL_DECKS) {
      const g = micDeckGainsRef.current[id];
      if (g) g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
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

  const playAnnouncement = useCallback(async (file: File, duckMusic: boolean = true) => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    if (duckMusic) setMicDuck(0.15);
    const buffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const g = ctx.createGain(); g.gain.value = 0.8;
    source.connect(g); g.connect(masterRef.current!);
    source.start();
    return new Promise<void>((resolve) => {
      source.onended = () => { if (duckMusic) setMicDuck(1); resolve(); };
    });
  }, [getCtx]);

  const getAnalyser = useCallback((deck: DeckId): AnalyserNode | null => {
    return analysersRef.current[deck] || null;
  }, []);

  const getOutputStream = useCallback((): MediaStream | null => {
    getCtx();
    return streamDestRef.current?.stream || null;
  }, [getCtx]);

  const getDeckOutputStream = useCallback((deck: DeckId): MediaStream | null => {
    getCtx();
    return deckStreamDestsRef.current[deck]?.stream || null;
  }, [getCtx]);

  const duckStart = useCallback(() => setMicDuck(0.15), []);
  const duckEnd = useCallback(() => setMicDuck(1), []);

  return {
    decks, micActive, jinglePlaying,
    loadTrack, play, pause, stop, setVolume,
    setEQ, setSpeed, setLoopStart, setLoopEnd, toggleLoop, clearLoop,
    setYoutubeUrl, youtubePlay, youtubeStop, setCustomJingle, playAnnouncement,
    startMic, stopMic, getAnalyser, getOutputStream, getDeckOutputStream,
    duckStart, duckEnd,
    // Mic duck settings
    micDuckLevel, setMicDuckLevel,
  };
}
