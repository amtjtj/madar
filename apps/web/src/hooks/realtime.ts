'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CHAT_SOCKET, REALTIME_EVENTS, REALTIME_PATH, type Message } from '@madar/shared';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

import { applyLiveMessage } from '@/lib/chat';

import {
  calendarKeys,
  chatKeys,
  dashboardKeys,
  letterKeys,
  meetingKeys,
  notificationKeys,
  workKeys,
} from './keys';

/**
 * Live updates: the server sends content-free hints and the matching queries refetch through
 * the API (which checks access). Returns whether the live connection is up.
 */
export function useRealtime(enabled: boolean, tenantId?: string): boolean {
  const client = useQueryClient();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: REALTIME_PATH, addTrailingSlash: false, withCredentials: true });
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several hints often arrive together (a move emits status + completion): refetch once.
    const refresh = (
      what: 'work' | 'today' | 'notifications' | 'letters' | 'chat' | 'chatLists' | 'meetings',
    ) => {
      pending.add(what);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending.has('work')) {
          void client.invalidateQueries({ queryKey: workKeys.allTasks });
          void client.invalidateQueries({ queryKey: ['task'] });
          void client.invalidateQueries({ queryKey: workKeys.projects });
          void client.invalidateQueries({ queryKey: dashboardKeys.all });
          void client.invalidateQueries({ queryKey: calendarKeys.all });
        }
        if (pending.has('today')) {
          void client.invalidateQueries({ queryKey: workKeys.today });
          void client.invalidateQueries({ queryKey: calendarKeys.all });
        }
        if (pending.has('notifications')) {
          void client.invalidateQueries({ queryKey: notificationKeys.all });
        }
        if (pending.has('letters')) void client.invalidateQueries({ queryKey: letterKeys.all });
        if (pending.has('meetings')) {
          void client.invalidateQueries({ queryKey: meetingKeys.all });
          void client.invalidateQueries({ queryKey: calendarKeys.all });
        }
        if (pending.has('chat') || pending.has('chatLists')) {
          void client.invalidateQueries({ queryKey: chatKeys.list });
          void client.invalidateQueries({ queryKey: chatKeys.unread });
          void client.invalidateQueries({ queryKey: ['chat', 'by-project'] });
        }
        // Membership, names and settings: only on the membership hint, not on every message.
        if (pending.has('chat')) {
          void client.invalidateQueries({ queryKey: ['chat', 'conversation'] });
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
        refresh('letters');
        refresh('meetings');
        refresh('chat');
        // Open conversations may have missed messages: reload them.
        void client.invalidateQueries({ queryKey: ['chat', 'messages'] });
      }
    });
    socket.on('disconnect', () => {
      wasDisconnected = true;
      setOnline(false);
    });
    socket.on(REALTIME_EVENTS.workChanged, () => refresh('work'));
    socket.on(REALTIME_EVENTS.todayChanged, () => refresh('today'));
    socket.on(REALTIME_EVENTS.notificationsChanged, () => refresh('notifications'));
    socket.on(REALTIME_EVENTS.lettersChanged, () => refresh('letters'));
    socket.on(REALTIME_EVENTS.meetingsChanged, () => refresh('meetings'));
    socket.on(REALTIME_EVENTS.chatChanged, () => refresh('chat'));
    // The one event with data (ADR 0022): straight into the open conversation's cache.
    socket.on(CHAT_SOCKET.message, (message: Message) => {
      applyLiveMessage(client, message);
      refresh('chatLists');
    });
    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
    // A new company means new rooms: reconnect when the active tenant changes.
  }, [client, enabled, tenantId]);

  return online;
}
