import { useRef, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';

export function usePeerHost() {
  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const connectionsRef = useRef<MediaConnection[]>([]);
  const [peerId, setPeerId] = useState('');
  const [listenerCount, setListenerCount] = useState(0);
  const [isHosting, setIsHosting] = useState(false);

  const startHosting = useCallback((stream: MediaStream, onPeerId?: (id: string) => void) => {
    if (peerRef.current) return;
    streamRef.current = stream;

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setIsHosting(true);
      if (onPeerId) onPeerId(id);
    });

    peer.on('call', (call) => {
      call.answer(streamRef.current!);
      connectionsRef.current.push(call);
      setListenerCount(c => c + 1);

      call.on('close', () => {
        connectionsRef.current = connectionsRef.current.filter(c => c !== call);
        setListenerCount(c => Math.max(0, c - 1));
      });

      call.on('error', () => {
        connectionsRef.current = connectionsRef.current.filter(c => c !== call);
        setListenerCount(c => Math.max(0, c - 1));
      });
    });

    peer.on('error', (err) => console.error('Peer host error:', err));
  }, []);

  const stopHosting = useCallback(() => {
    connectionsRef.current.forEach(c => c.close());
    connectionsRef.current = [];
    peerRef.current?.destroy();
    peerRef.current = null;
    streamRef.current = null;
    setPeerId('');
    setIsHosting(false);
    setListenerCount(0);
  }, []);

  return { peerId, listenerCount, isHosting, startHosting, stopHosting };
}

export function usePeerListener() {
  const peerRef = useRef<Peer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const pendingStreamRef = useRef<MediaStream | null>(null);

  const playStream = useCallback((stream: MediaStream) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.autoplay = true;
    }
    audioRef.current.srcObject = stream;
    const playPromise = audioRef.current.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsConnected(true);
          setNeedsUserGesture(false);
        })
        .catch(() => {
          // Autoplay blocked — wait for user to tap play
          pendingStreamRef.current = stream;
          setNeedsUserGesture(true);
          setIsConnected(true); // still show connected UI
        });
    }
  }, []);

  const resumePlayback = useCallback(() => {
    if (pendingStreamRef.current && audioRef.current) {
      audioRef.current.srcObject = pendingStreamRef.current;
      audioRef.current.play().then(() => {
        setNeedsUserGesture(false);
        pendingStreamRef.current = null;
      }).catch(console.error);
    }
  }, []);

  const connect = useCallback((hostId: string) => {
    if (peerRef.current) return;

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      // Create silent stream to initiate call
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      osc.start();

      const call = peer.call(hostId, dest.stream);

      call.on('stream', (stream) => {
        osc.stop();
        ctx.close();
        playStream(stream);
      });

      call.on('close', () => setIsConnected(false));
      call.on('error', () => setIsConnected(false));
    });

    peer.on('error', (err) => {
      console.error('Peer listener error:', err);
      setIsConnected(false);
    });
  }, [playStream]);

  const disconnect = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    peerRef.current?.destroy();
    peerRef.current = null;
    pendingStreamRef.current = null;
    setIsConnected(false);
    setNeedsUserGesture(false);
  }, []);

  const setListenerVolume = useCallback((vol: number) => {
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  return { isConnected, needsUserGesture, resumePlayback, connect, disconnect, setListenerVolume };
}
