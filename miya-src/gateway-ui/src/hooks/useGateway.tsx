import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { GatewayRpcClient } from '../gateway-client';
import type { GatewaySnapshot, KillSwitchMode, PsycheModeConfig, TrustModeConfig } from '../types/gateway';
import { useMemoizedSnapshot } from './useMemoizedSnapshot';

/**
 * Context value interface
 * Provides snapshot data and control methods
 */
export interface GatewayContextValue {
  /** Current gateway snapshot data */
  snapshot: GatewaySnapshot | null;
  
  /** Loading state (true during initial load) */
  loading: boolean;
  
  /** Connection state */
  connected: boolean;
  
  /** Error message if any */
  error: string | null;
  
  /** Manually refresh the snapshot */
  refresh: () => Promise<void>;
  
  /** Set kill switch mode */
  setKillSwitch: (mode: KillSwitchMode, reason?: string) => Promise<void>;
  
  /** Update psyche mode configuration */
  updatePsycheMode: (config: Partial<PsycheModeConfig>) => Promise<void>;
  
  /** Update trust mode configuration */
  updateTrustMode: (config: Partial<TrustModeConfig>) => Promise<void>;
  
  /** Toggle policy domain pause state */
  togglePolicyDomain: (domain: string, paused: boolean) => Promise<void>;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

/**
 * Custom hook to access gateway context
 * Throws error if used outside GatewayProvider
 */
export function useGateway(): GatewayContextValue {
  const context = useContext(GatewayContext);
  if (!context) {
    throw new Error('useGateway must be used within GatewayProvider');
  }
  return context;
}

interface GatewayProviderProps {
  children: React.ReactNode;
  /** WebSocket path (default: /gateway/ws) */
  wsPath?: string;
  /** Polling interval in milliseconds (default: 2500) */
  pollingInterval?: number;
  /** Token provider function */
  tokenProvider?: () => string;
}

/**
 * GatewayProvider component
 * 
 * Manages GatewaySnapshot state and provides it to child components
 * Maintains existing WebSocket/HTTP polling logic for backward compatibility
 */
export function GatewayProvider({
  children,
  wsPath = '/gateway/ws',
  pollingInterval = 2500,
  tokenProvider,
}: GatewayProviderProps): React.ReactElement {
  const [snapshot, setSnapshot] = useState<GatewaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Apply memoization to prevent unnecessary re-renders (Requirement 12.1, 12.11)
  const memoizedSnapshot = useMemoizedSnapshot(snapshot);
  
  const clientRef = useRef<GatewayRpcClient | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  /**
   * Initialize RPC client
   */
  useEffect(() => {
    clientRef.current = new GatewayRpcClient({
      wsPath,
      tokenProvider,
      timeoutMs: 20000,
    });

    return () => {
      mountedRef.current = false;
      if (clientRef.current) {
        clientRef.current.dispose();
        clientRef.current = null;
      }
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [wsPath, tokenProvider]);

  /**
   * Fetch snapshot from gateway
   */
  const fetchSnapshot = useCallback(async (): Promise<void> => {
    if (!clientRef.current || !mountedRef.current) {
      return;
    }

    try {
      const result = await clientRef.current.request('getSnapshot', {});
      
      if (!mountedRef.current) {
        return;
      }

      const newSnapshot = result as GatewaySnapshot;
      
      setSnapshot(newSnapshot);
      setConnected(true);
      setError(null);
      
      // Only set loading to false after first successful fetch
      if (loading) {
        setLoading(false);
      }
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // Keep previous snapshot on error (Requirement 12.5)
      // Only update error state
      setError(errorMessage);
      setConnected(false);
      
      // Set loading to false even on error
      if (loading) {
        setLoading(false);
      }
    }
  }, [loading]);

  /**
   * Start polling loop
   */
  useEffect(() => {
    const poll = async (): Promise<void> => {
      await fetchSnapshot();
      
      if (mountedRef.current) {
        pollingTimerRef.current = setTimeout(poll, pollingInterval);
      }
    };

    // Start initial fetch
    poll();

    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [fetchSnapshot, pollingInterval]);

  /**
   * Manual refresh
   */
  const refresh = useCallback(async (): Promise<void> => {
    await fetchSnapshot();
  }, [fetchSnapshot]);

  /**
   * Set kill switch mode
   */
  const setKillSwitch = useCallback(async (mode: KillSwitchMode, reason?: string): Promise<void> => {
    if (!clientRef.current || actionInFlightRef.current) {
      return;
    }

    actionInFlightRef.current = true;
    try {
      await clientRef.current.request('setKillSwitch', {
        mode,
        reason: reason || undefined,
        policyHash: snapshot?.policyHash,
      });
      
      // Refresh snapshot after successful update
      await fetchSnapshot();
    } finally {
      actionInFlightRef.current = false;
    }
  }, [snapshot?.policyHash, fetchSnapshot]);

  /**
   * Update psyche mode configuration
   */
  const updatePsycheMode = useCallback(async (config: Partial<PsycheModeConfig>): Promise<void> => {
    if (!clientRef.current || actionInFlightRef.current) {
      return;
    }

    actionInFlightRef.current = true;
    try {
      await clientRef.current.request('updatePsycheMode', {
        config,
        policyHash: snapshot?.policyHash,
      });
      
      // Refresh snapshot after successful update
      await fetchSnapshot();
    } finally {
      actionInFlightRef.current = false;
    }
  }, [snapshot?.policyHash, fetchSnapshot]);

  /**
   * Update trust mode configuration
   */
  const updateTrustMode = useCallback(async (config: Partial<TrustModeConfig>): Promise<void> => {
    if (!clientRef.current || actionInFlightRef.current) {
      return;
    }

    actionInFlightRef.current = true;
    try {
      await clientRef.current.request('updateTrustMode', {
        config,
        policyHash: snapshot?.policyHash,
      });
      
      // Refresh snapshot after successful update
      await fetchSnapshot();
    } finally {
      actionInFlightRef.current = false;
    }
  }, [snapshot?.policyHash, fetchSnapshot]);

  /**
   * Toggle policy domain pause state
   */
  const togglePolicyDomain = useCallback(async (domain: string, paused: boolean): Promise<void> => {
    if (!clientRef.current || actionInFlightRef.current) {
      return;
    }

    actionInFlightRef.current = true;
    try {
      await clientRef.current.request('togglePolicyDomain', {
        domain,
        paused,
        policyHash: snapshot?.policyHash,
      });
      
      // Refresh snapshot after successful update
      await fetchSnapshot();
    } finally {
      actionInFlightRef.current = false;
    }
  }, [snapshot?.policyHash, fetchSnapshot]);

  const contextValue: GatewayContextValue = {
    snapshot: memoizedSnapshot,
    loading,
    connected,
    error,
    refresh,
    setKillSwitch,
    updatePsycheMode,
    updateTrustMode,
    togglePolicyDomain,
  };

  return (
    <GatewayContext.Provider value={contextValue}>
      {children}
    </GatewayContext.Provider>
  );
}
