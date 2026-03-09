import React from 'react';
import {Box, Text} from 'ink';
import {getCharacter, getActivityColor} from '../characters.js';
import type {AgentSession} from '../types.js';

interface AgentCardProps {
  session: AgentSession;
  width: number;
  selected?: boolean;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h${remainingMin > 0 ? `${remainingMin}m` : ''}`;
}

export function AgentCard({session, width, selected}: AgentCardProps) {
  const character = getCharacter(session.activity);
  const color = getActivityColor(session.activity);
  const now = Date.now();
  const duration = session.sessionStartedAt
    ? formatDuration(now - session.sessionStartedAt)
    : '';

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      <Text bold wrap="truncate">
        {session.repoName || session.projectName}
        {session.gitBranch ? (
          <Text dimColor> ({session.gitBranch})</Text>
        ) : null}
      </Text>

      <Text dimColor italic wrap="truncate-end">{session.taskSummary || ' '}</Text>

      <Box justifyContent="center" marginY={1}>
        <Text color="greenBright">{selected ? '> ' : '  '}</Text><Text color={color}>{character.art}</Text>
      </Box>

      <Text color={color} wrap="truncate">{session.statusText}</Text>

      {session.currentFile ? (
        <Text dimColor wrap="truncate">File: {session.currentFile}</Text>
      ) : null}

      {session.activeSubagents > 0 ? (
        <Text color="magenta">
          Subagents: {session.activeSubagents}
        </Text>
      ) : null}

      {session.contextTokens > 0 ? (
        <Text dimColor>
          Context: {formatTokens(session.contextTokens)}{' '}
          ({Math.round((session.contextTokens / session.contextMaxTokens) * 100)}%)
        </Text>
      ) : null}

      {duration ? (
        <Text dimColor>Session: {duration}</Text>
      ) : null}

      <Box height={3} overflow="hidden" marginTop={1}>
        <Text dimColor wrap="wrap">{session.lastResponseText || ' '}</Text>
      </Box>
    </Box>
  );
}
