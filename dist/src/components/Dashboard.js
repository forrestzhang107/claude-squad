import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { scanSessions } from '../scanner.js';
import { createSession, startWatching } from '../watcher.js';
import { AgentCard } from './AgentCard.js';
const RESCAN_INTERVAL_MS = 5000;
const CARD_WIDTH = 40;
export function Dashboard({ projectFilter, showAll }) {
    const { exit } = useApp();
    const [sessions, setSessions] = useState([]);
    const [tick, setTick] = useState(0);
    useInput((input, key) => {
        if (input === 'q' || (input === 'c' && key.ctrl)) {
            exit();
        }
    });
    useEffect(() => {
        const cleanups = [];
        const tracked = new Map();
        function scan() {
            const discovered = scanSessions({ showAll, projectFilter });
            for (const d of discovered) {
                if (tracked.has(d.jsonlFile))
                    continue;
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
            for (const cleanup of cleanups)
                cleanup();
        };
    }, [projectFilter, showAll]);
    if (sessions.length === 0) {
        return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Text, { bold: true, color: "cyan", children: "claude-hq" }), _jsx(Text, { dimColor: true, children: "No active Claude sessions found." }), _jsx(Text, { dimColor: true, children: "Start a Claude Code session and it will appear here." })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, color: "cyan", children: "claude-hq " }), _jsxs(Text, { dimColor: true, children: [sessions.length, " session", sessions.length !== 1 ? 's' : '', " | q to quit"] })] }), _jsx(Box, { flexDirection: "row", flexWrap: "wrap", gap: 1, children: sessions.map((session) => (_jsx(AgentCard, { session: session, width: CARD_WIDTH }, session.jsonlFile))) })] }));
}
//# sourceMappingURL=Dashboard.js.map