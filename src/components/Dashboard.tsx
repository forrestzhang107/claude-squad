import React, {useState, useEffect} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import {scanSessions} from '../scanner.js';
import {createSession, startWatching} from '../watcher.js';
import type {AgentSession} from '../types.js';
import {AgentCard} from './AgentCard.js';

interface DashboardProps {
  projectFilter?: string;
  showAll?: boolean;
}

const RESCAN_INTERVAL_MS = 5000;
const CARD_WIDTH = 30;

export function Dashboard({projectFilter, showAll}: DashboardProps) {
  const {exit} = useApp();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [tick, setTick] = useState(0);

  useInput((input, key) => {
    if (input === 'q' || (input === 'c' && key.ctrl)) {
      exit();
    }
  });

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const tracked = new Map<string, AgentSession>();

    function scan() {
      const discovered = scanSessions({showAll, projectFilter});

      for (const d of discovered) {
        if (tracked.has(d.jsonlFile)) continue;

        const session = createSession(d);
        tracked.set(d.jsonlFile, session);

        const cleanup = startWatching(session, () => {
          setTick((t) => t + 1);
        });
        cleanups.push(cleanup);
      }

      setSessions(Array.from(tracked.values()));
    }

    scan();
    const interval = setInterval(scan, RESCAN_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      for (const cleanup of cleanups) cleanup();
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
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} | q to
          quit
        </Text>
      </Box>

      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {sessions.map((session) => (
          <AgentCard
            key={session.jsonlFile}
            session={session}
            width={CARD_WIDTH}
          />
        ))}
      </Box>
    </Box>
  );
}
