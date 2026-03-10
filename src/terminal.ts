import {execSync} from 'node:child_process';

/**
 * Switch Terminal.app to the tab with the given TTY.
 */
export function switchToTerminalTab(tty: string): void {
  try {
    if (!/^\/dev\/ttys?\d+$/.test(tty)) return;

    const script = `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        set selected tab of w to t
        set index of w to 1
        activate
        return
      end if
    end repeat
  end repeat
end tell`;

    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Terminal tab not found
  }
}
