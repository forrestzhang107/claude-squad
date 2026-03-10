import React from 'react';
import {Box, Text} from 'ink';
import {getCharacter, getActivityColor} from '../characters.js';
import type {AgentSession} from '../types.js';

interface AgentCardProps {
  session: AgentSession;
  width: number;
  selected?: boolean;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h${remainingMin > 0 ? `${remainingMin}m` : ''}`;
}

export function AgentCard({session, width, selected}: AgentCardProps) {
  const now = Date.now();
  const character = getCharacter(session.activity);
  const color = getActivityColor(session.activity);
  const duration = session.processStartedAt ? formatDuration(now - session.processStartedAt) : '';

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      <Text bold wrap="truncate">
        {session.projectName}
        {session.gitBranch ? (
          <Text dimColor> ({session.gitBranch})</Text>
        ) : null}
      </Text>

      <Box justifyContent="center" marginY={1}>
        <Text color="magenta">{selected ? '* ' : '  '}</Text><Text color={color}>{character.art}</Text>
      </Box>

      <Text color={color} wrap="truncate">{session.statusText}</Text>

      {duration ? (
        <Text dimColor>Session: {duration}</Text>
      ) : null}

      {session.lastPrompt ? (
        <Box marginTop={1} height={2} overflow="hidden">
          <Text wrap="wrap">&gt; {session.lastPrompt}</Text>
        </Box>
      ) : null}
      {session.lastResponse.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {session.lastResponse.map((line, i) => (
            <Text key={i} wrap="truncate">{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
