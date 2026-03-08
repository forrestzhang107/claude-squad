import React from 'react';
import {Dashboard} from './components/Dashboard.js';

interface AppProps {
  projectFilter?: string;
  showAll?: boolean;
}

export function App({projectFilter, showAll}: AppProps) {
  return <Dashboard projectFilter={projectFilter} showAll={showAll} />;
}
