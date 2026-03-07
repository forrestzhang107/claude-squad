import React from 'react';
import {Box, Text} from 'ink';

interface AppProps {
  projectFilter?: string;
  showAll?: boolean;
}

export function App({projectFilter, showAll}: AppProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">claude-squad</Text>
      <Text dimColor>Scanning for active sessions...</Text>
    </Box>
  );
}
