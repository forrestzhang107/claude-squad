import React, {useState, useEffect} from 'react';
import {Box, Text, useInput, useApp, useStdout} from 'ink';
import {pollSessions} from '../poller.js';
import type {AgentSession} from '../types.js';
import {AgentCard} from './AgentCard.js';
import {switchToTerminalTab} from '../terminal.js';

const POLL_INTERVAL_MS = 2000;
const CARD_WIDTH = 40;

export function Dashboard() {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [initialPollDone, setInitialPollDone] = useState(false);

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
      if (session) {
        switchToTerminalTab(session.tty);
      }
    }
  });

  useEffect(() => {
    const previous = new Map<number, AgentSession>();

    function poll() {
      const current = pollSessions(previous);

      // Update previous map for next poll
      previous.clear();
      for (const s of current) {
        previous.set(s.pid, s);
      }

      setSessions(current);
    }

    poll();
    setInitialPollDone(true);
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  if (!initialPollDone) {
    return null;
  }

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
            key={session.pid}
            session={session}
            width={CARD_WIDTH}
            selected={i === selectedIndex}
          />
        ))}
      </Box>
    </Box>
  );
}
