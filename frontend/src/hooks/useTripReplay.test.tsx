import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTripReplay } from './useTripReplay';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('useTripReplay Hook', () => {
  it('initializes with default 24h duration and chunk size', () => {
    const { result } = renderHook(() => useTripReplay({ tripId: 1 }), {
      wrapper: createWrapper(),
    });

    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(86400);
    expect(result.current.chunkSize).toBe(600);
    expect(result.current.chunkIndex).toBe(0);
    expect(result.current.fromT).toBe(0);
    expect(result.current.toT).toBe(600);
  });

  it('clamps chunkIndex and window boundaries at t = 86,400s (prevents empty window)', () => {
    const { result } = renderHook(
      () =>
        useTripReplay({
          tripId: 1,
          duration: 86400,
          initialTime: 86400,
          chunkSize: 600,
        }),
      { wrapper: createWrapper() }
    );

    // Total chunks for 86400s at 600s is 144 (indices 0..143)
    // At t=86400, chunkIndex must be clamped to 143, NOT 144
    expect(result.current.currentTime).toBe(86400);
    expect(result.current.chunkIndex).toBe(143);
    expect(result.current.fromT).toBe(85800);
    expect(result.current.toT).toBe(86400);
  });

  it('supports bidirectional zoom levels', () => {
    const { result } = renderHook(
      () =>
        useTripReplay({
          tripId: 1,
          chunkSize: 600,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.zoomLevel).toBe(600);

    // Zoom in (narrower window: 600 -> 300)
    act(() => {
      result.current.zoomIn();
    });
    expect(result.current.zoomLevel).toBe(300);
    expect(result.current.chunkSize).toBe(300);

    // Zoom in again (300 -> 60)
    act(() => {
      result.current.zoomIn();
    });
    expect(result.current.zoomLevel).toBe(60);

    // Zoom out (60 -> 300 -> 600 -> 1800 -> 3600)
    act(() => {
      result.current.zoomOut();
    });
    expect(result.current.zoomLevel).toBe(300);

    act(() => {
      result.current.setZoomLevel(3600);
    });
    expect(result.current.zoomLevel).toBe(3600);
    expect(result.current.chunkSize).toBe(3600);
  });

  it('clamps seekTo boundaries between 0 and duration', () => {
    const { result } = renderHook(() => useTripReplay({ tripId: 1, duration: 86400 }), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.seekTo(-500);
    });
    expect(result.current.currentTime).toBe(0);

    act(() => {
      result.current.seekTo(100000);
    });
    expect(result.current.currentTime).toBe(86400);
  });
});
