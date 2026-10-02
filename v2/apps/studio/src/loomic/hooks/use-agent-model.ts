"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "../lib/auth-context";

const STORAGE_KEY = "loomic:agent-model";

type AgentModel = string | null; // null = auto (workspace default)

// Listeners for cross-component reactivity
const listeners = new Set<() => void>();
function emitChange() {
  for (const listener of listeners) listener();
}

// Cache parsed result -- useSyncExternalStore requires stable references
let cachedRaw: string | null | undefined;
let cachedModel: AgentModel = null;
let cachedKey: string | undefined;

function getSnapshot(key: string): AgentModel {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== cachedRaw || key !== cachedKey) {
      cachedKey = key;
      cachedRaw = raw;
      cachedModel = raw || null;
    }
    return cachedModel;
  } catch {
    return null;
  }
}

function getServerSnapshot(): AgentModel {
  return null;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useAgentModel() {
  const { user } = useAuth();
  // The legacy unowned preference remains untouched; it cannot express whose
  // choice it was on a shared browser and is not adopted into another account.
  const key = `${STORAGE_KEY}:local:${user?.id ?? 'guest'}`;
  const snapshot = useCallback(() => getSnapshot(key), [key]);
  const model = useSyncExternalStore(subscribe, snapshot, getServerSnapshot);

  const setModel = useCallback((next: AgentModel) => {
    if (next) {
      localStorage.setItem(key, next);
    } else {
      localStorage.removeItem(key);
    }
    emitChange();
  }, [key]);

  return { model, setModel };
}
