import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { getCharacter, getActivityColor } from '../characters.js';
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMin = minutes % 60;
    return `${hours}h${remainingMin > 0 ? `${remainingMin}m` : ''}`;
}
export function AgentCard({ session, width }) {
    const character = getCharacter(session.activity);
    const color = getActivityColor(session.activity);
    const now = Date.now();
    const duration = session.sessionStartedAt
        ? formatDuration(now - session.sessionStartedAt)
        : '';
    return (_jsxs(Box, { flexDirection: "column", width: width, borderStyle: "round", borderColor: color, paddingX: 1, children: [_jsxs(Text, { bold: true, wrap: "truncate", children: [session.repoName || session.projectName, session.gitBranch ? (_jsxs(Text, { dimColor: true, children: [" (", session.gitBranch, ")"] })) : null] }), session.taskSummary ? (_jsx(Text, { dimColor: true, italic: true, wrap: "truncate-end", children: session.taskSummary })) : null, _jsx(Box, { justifyContent: "center", marginY: 1, children: _jsx(Text, { color: color, children: character.art }) }), _jsx(Text, { color: color, wrap: "truncate", children: session.statusText }), session.currentFile ? (_jsxs(Text, { dimColor: true, wrap: "truncate", children: ["File: ", session.currentFile] })) : null, session.activeSubagents > 0 ? (_jsxs(Text, { color: "magenta", children: ["Subagents: ", session.activeSubagents] })) : null, duration ? (_jsxs(Text, { dimColor: true, children: ["Session: ", duration] })) : null, session.toolHistory.length > 0 ? (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { dimColor: true, children: "Recent:" }), session.toolHistory.map((entry, i) => (_jsxs(Text, { dimColor: true, wrap: "truncate", children: [i === session.toolHistory.length - 1 ? ' > ' : '   ', entry.status] }, i)))] })) : null] }));
}
//# sourceMappingURL=AgentCard.js.map