#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
import { render } from 'ink';
import { App } from '../src/app.js';
const args = process.argv.slice(2);
const projectFilter = args.includes('--project')
    ? args[args.indexOf('--project') + 1]
    : undefined;
const showAll = args.includes('--all');
render(_jsx(App, { projectFilter: projectFilter, showAll: showAll }));
//# sourceMappingURL=cli.js.map