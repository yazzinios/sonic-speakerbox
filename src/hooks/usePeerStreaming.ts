import { useRef, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS } from '@/types/channels';

// One peer per deck channel
interface DeckPeer {
  peer: Peer;
  connections: MediaConnection[];
}

export function usePeerHost() {
  const deckPeersRef = useRef<Partial<Record<DeckId, DeckPeer>>>({});
  const [listenerCounts, setListenerCounts] = useState<Record<DeckId, number>>({ A: 0, B: 0, C: 0, D: 0 });
  const [isHosting, setIsHosting] = useState(false);
  const [peerIds, setPeerIds] = useState<Partial<Record<DeckId, string>>>({});

  // Total listeners across all decks
  const listenerCount = Object.values(listenerCounts).reduce((a, b) => a + b, 0);

  const startHosting = useCallback((
    getDeckStream: (deck: DeckId) => MediaStream | null,
    channelCodes: Partial<Record<DeckId, string>>
  ) => {
    if (Object.keys(deckPeersRef.current).length > 0) return;

    ALL_DECKS.forEach((deckId) => {
      const stream = getDeckStream(deckId);
      if (!stream) return;

      const code = channelCodes[deckId];
      const peerId = code ? code.toLowerCase().replace(/[^a-z0-9]/g, '-') : undefined;
      const peer = peerId ? new Peer(peerId) : new Peer();
      const deckPeer: DeckPeer = { peer, connections: [] };
      deckPeersRef.current[deckId] = deckPeer;

      peer.on('open', (id) => {
        setPeerIds(prev => ({ ...prev, [deckId]: id }));
        // Mark hosting once at least one peer is open
        setIsHosting(true);
      });

      peer.on('call', (call) => {
        // Answer with this deck's specific stream
        call.answer(stream);
        deckPeer.connections.push(call);
        setListenerCounts(prev => ({ ...prev, [deckId]: prev[deckId] + 1 }));

        call.on('close', () => {
          deckPeer.connections = deckPeer.connections.filter(c => c !== call);
          setListenerCounts(prev => ({ ...prev, [deckId]: Math.max(0, prev[deckId] - 1) }));
        });
        call.on('error', () => {
          deckPeer.connections = deckPeer.connections.filter(c => c !== call);
          setListenerCounts(prev => ({ ...prev, [deckId]: Math.max(0, prev[deckId] - 1) }));
        });
      });

      peer.on('error', (err) => console.error(`Peer host error [Deck ${deckId}]:`, err));
    });
  }, []);

  const stopHosting = useCallback(() => {
    ALL_DECKS.forEach((deckId) => {
      const dp = deckPeersRef.current[deckId];
      if (dp) {
        dp.connections.forEach(c => c.close());
        dp.peer.destroy();
      }
    });
    deckPeersRef.current = {};
    setPeerIds({});
    setListenerCounts({ A: 0, B: 0, C: 0, D: 0 });
    setIsHosting(false);
  }, []);

  return { peerIds, listenerCount, listenerCounts, isHosting, startHosting, stopHosting };
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
          pendingStreamRef.current = stream;
          setNeedsUserGesture(true);
          setIsConnected(true);
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
      // Silent stream to initiate call
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
