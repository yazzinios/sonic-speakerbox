import { useState, useCallback } from 'react';

export interface DJSettings {
  backgroundImage: string;
  djName: string;
  stationName: string;
}

const STORAGE_KEY = 'dj-settings';

function loadSettings(): DJSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { backgroundImage: '', djName: '', stationName: 'DJ CONSOLE' };
}

export function useDJSettings() {
  const [settings, setSettingsState] = useState<DJSettings>(loadSettings);

  const updateSettings = useCallback((partial: Partial<DJSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
