import {execSync} from 'node:child_process';

/**
 * Switch Terminal.app to the tab running the given PID.
 * Resolves PID -> TTY, then uses AppleScript to activate that tab.
 */
export function switchToTerminalTab(pid: number): void {
  try {
    const ttyRaw = execSync(`ps -o tty= -p ${pid}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!ttyRaw) return;

    // ps returns e.g. "ttys003", we need "/dev/ttys003"
    const tty = ttyRaw.startsWith('/dev/') ? ttyRaw : `/dev/${ttyRaw}`;

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
    // Process may have exited or terminal tab not found
  }
}
