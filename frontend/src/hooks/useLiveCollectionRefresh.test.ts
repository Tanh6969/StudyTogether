import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitDataChange } from '../lib/dataChange';
import { useLiveCollectionRefresh } from './useLiveCollectionRefresh';

vi.mock('../mocks/config', () => ({ USE_MOCK: false }));
const fake = vi.hoisted(() => ({ handlers: [] as Array<() => void>, remove: vi.fn(), channel: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: fake.channel.mockImplementation(() => {
      const channel = {
        on: vi.fn((_name, _filter, handler: () => void) => { fake.handlers.push(handler); return channel; }),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    }),
    removeChannel: fake.remove,
  },
}));

describe('useLiveCollectionRefresh', () => {
  beforeEach(() => {
    fake.handlers.length = 0;
    fake.channel.mockClear();
    fake.remove.mockClear();
  });

  it('reacts to a same-tab resource creation with no F5', async () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLiveCollectionRefresh({
      enabled: true, watchPaths: ['/resources/files'], onRefresh: refresh,
    }));
    act(() => emitDataChange({ path: '/resources/files', method: 'POST' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unmount();
  });

  it('scopes database notifications to the requested group and cleans up', async () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLiveCollectionRefresh({
      enabled: true, table: 'resources', filter: 'group_id=eq.abc',
      watchPaths: ['/resources/files'], onRefresh: refresh,
    }));
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.handlers).toHaveLength(1);
    act(() => fake.handlers[0]());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unmount();
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  it('ignores irrelevant mutations and does not refresh after unmount', async () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLiveCollectionRefresh({
      enabled: true, watchPaths: ['/resources/files'], onRefresh: refresh,
    }));
    act(() => emitDataChange({ path: '/roadmaps', method: 'POST' }));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(refresh).not.toHaveBeenCalled();
  });
});
