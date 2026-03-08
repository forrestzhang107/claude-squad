import React from 'react';
import {Box, Text} from 'ink';
import {getCharacter, getActivityColor} from '../characters.js';
import type {AgentSession} from '../types.js';

interface AgentCardProps {
  session: AgentSession;
  width: number;
}

export function AgentCard({session, width}: AgentCardProps) {
  const character = getCharacter(session.activity);
  const color = getActivityColor(session.activity);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold>{session.projectName}</Text>
        {session.gitBranch ? (
          <Text dimColor>({session.gitBranch})</Text>
        ) : null}
      </Box>

      <Box justifyContent="center" marginY={1}>
        <Text color={color}>{character.art}</Text>
      </Box>

      <Text wrap="truncate">
        <Text color={color}>{session.statusText}</Text>
      </Text>
    </Box>
  );
}
