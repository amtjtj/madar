'use client';

import { useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, REALTIME_PATH } from '@madar/shared';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

import { notificationKeys } from './notifications';
import { workKeys } from './work';

/**
 * Live updates: the server sends content-free hints and the matching queries refetch through
 * the API (which checks access). Returns whether the live connection is up.
 */
export function useRealtime(enabled: boolean): boolean {
  const client = useQueryClient();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: REALTIME_PATH, addTrailingSlash: false, withCredentials: true });
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several hints often arrive together (a move emits status + completion): refetch once.
    const refresh = (what: 'work' | 'today' | 'notifications') => {
      pending.add(what);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending.has('work')) {
          void client.invalidateQueries({ queryKey: workKeys.allTasks });
          void client.invalidateQueries({ queryKey: ['task'] });
          void client.invalidateQueries({ queryKey: workKeys.projects });
        }
        if (pending.has('today')) void client.invalidateQueries({ queryKey: workKeys.today });
        if (pending.has('notifications')) {
          void client.invalidateQueries({ queryKey: notificationKeys.all });
        }
        pending.clear();
      }, 250);
    };
    let wasDisconnected = false;
    socket.on('connect', () => {
      setOnline(true);
      // Catch up on whatever happened while we were away.
      if (wasDisconnected) {
        refresh('work');
        refresh('today');
        refresh('notifications');
      }
    });
    socket.on('disconnect', () => {
      wasDisconnected = true;
      setOnline(false);
    });
    socket.on(REALTIME_EVENTS.workChanged, () => refresh('work'));
    socket.on(REALTIME_EVENTS.todayChanged, () => refresh('today'));
    socket.on(REALTIME_EVENTS.notificationsChanged, () => refresh('notifications'));
    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
  }, [client, enabled]);

  return online;
}
