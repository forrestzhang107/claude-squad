#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App} from '../src/app.js';

process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
render(<App />);
