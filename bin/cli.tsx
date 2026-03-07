#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App} from '../src/app.js';

const args = process.argv.slice(2);
const projectFilter = args.includes('--project')
  ? args[args.indexOf('--project') + 1]
  : undefined;
const showAll = args.includes('--all');

render(<App projectFilter={projectFilter} showAll={showAll} />);
