import React, {useState, useEffect} from 'react';
import {Box, Text, useInput, useApp, useStdout} from 'ink';
import {scanSessions} from '../scanner.js';
import {createSession, startWatching} from '../watcher.js';
import type {AgentSession} from '../types.js';
import {AgentCard} from './AgentCard.js';
import {switchToTerminalTab} from '../terminal.js';

interface DashboardProps {
  projectFilter?: string;
  showAll?: boolean;
}

const RESCAN_INTERVAL_MS = 5000;
const CARD_WIDTH = 40;

export function Dashboard({projectFilter, showAll}: DashboardProps) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [tick, setTick] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // padding=1 adds 1 char on each side, gap=1 adds 1 char between cards
  const cols = Math.max(1, Math.floor(((stdout?.columns ?? 80) - 2) / (CARD_WIDTH + 1)));

  const lastIndex = sessions.length - 1;
  const clamp = (n: number): number => Math.max(0, Math.min(lastIndex, n));

  useEffect(() => {
    setSelectedIndex(clamp);
  }, [sessions.length]);

  useInput((input, key) => {
    if (input === 'q' || (input === 'c' && key.ctrl)) {
      exit();
    } else if (key.leftArrow) {
      setSelectedIndex((i) => clamp(i - 1));
    } else if (key.rightArrow) {
      setSelectedIndex((i) => clamp(i + 1));
    } else if (key.upArrow) {
      setSelectedIndex((i) => clamp(i - cols));
    } else if (key.downArrow) {
      setSelectedIndex((i) => clamp(i + cols));
    } else if (key.return) {
      const session = sessions[selectedIndex];
      if (session?.pid) {
        switchToTerminalTab(session.pid);
      }
    }
  });

  useEffect(() => {
    const tracked = new Map<string, AgentSession>();
    const cleanupFns = new Map<string, () => void>();

    function scan() {
      const discovered = scanSessions({showAll, projectFilter});
      const discoveredKeys = new Set(discovered.map((d) => d.jsonlFile));

      // Remove sessions that are no longer discovered
      for (const key of tracked.keys()) {
        if (!discoveredKeys.has(key)) {
          tracked.delete(key);
          const cleanup = cleanupFns.get(key);
          if (cleanup) {
            cleanup();
            cleanupFns.delete(key);
          }
        }
      }

      // Add newly discovered sessions
      for (const d of discovered) {
        const existing = tracked.get(d.jsonlFile);
        if (existing) {
          existing.pid = d.pid;
          existing.processStartedAt = d.processStartedAt;
          continue;
        }

        const session = createSession(d);
        tracked.set(d.jsonlFile, session);

        const cleanup = startWatching(session, () => {
          setTick((t) => t + 1);
        });
        cleanupFns.set(d.jsonlFile, cleanup);
      }

      setSessions(Array.from(tracked.values()));
    }

    scan();
    const interval = setInterval(scan, RESCAN_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      for (const cleanup of cleanupFns.values()) cleanup();
    };
  }, [projectFilter, showAll]);

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">claude-squad</Text>
        <Text dimColor>No active Claude sessions found.</Text>
        <Text dimColor>Start a Claude Code session and it will appear here.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">claude-squad </Text>
        <Text dimColor>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} | ←→↑↓
          navigate | enter: switch terminal | q: quit
        </Text>
      </Box>

      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {sessions.map((session, i) => (
          <AgentCard
            key={session.jsonlFile}
            session={session}
            width={CARD_WIDTH}
            selected={i === selectedIndex}
          />
        ))}
      </Box>
    </Box>
  );
}
