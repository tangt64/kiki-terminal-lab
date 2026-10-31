import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "../xterm.css";

function terminalWebSocketUrl(path) {
  if (/^wss?:\/\//i.test(String(path || ""))) return path;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export default function ArenaTerminal({ lines = [], title = "콘솔", terminalSession = null }) {
  const rootRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!rootRef.current) return undefined;
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: false,
      fontFamily: "'Nanum Gothic Coding', Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.3,
      rows: 16,
      scrollback: 3000,
      theme: {
        background: "#020617",
        foreground: "#e0f2fe",
        cursor: "#93c5fd",
        selectionBackground: "rgba(147, 197, 253, 0.22)",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(rootRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const fit = () => window.requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });
    fit();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    resizeObserver?.observe(rootRef.current);
    return () => {
      socketRef.current?.close();
      resizeObserver?.disconnect();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return undefined;
    socketRef.current?.close();
    terminal.clear();

    if (!terminalSession?.wsPath) {
      terminal.writeln(`[${title}]\r\n`);
      lines.forEach((line) => terminal.writeln(line));
      return undefined;
    }

    terminal.writeln(`[${terminalSession.targetLabel || title}] 연결 중...\r\n`);
    const socket = new WebSocket(terminalWebSocketUrl(terminalSession.wsPath));
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      try {
        fitAddon.fit();
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      } catch {}
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "data" || payload.type === "output") terminal.write(String(payload.data || ""));
        if (payload.type === "status") terminal.writeln(`\r\n[안내] ${payload.message}`);
        if (payload.type === "error") terminal.writeln(`\r\n[오류] ${payload.message}`);
        if (payload.type === "exit") terminal.writeln("\r\n[세션 종료]");
      } catch {
        terminal.write(String(event.data || ""));
      }
    });
    socket.addEventListener("close", () => terminal.writeln("\r\n[연결 종료]"));
    socket.addEventListener("error", () => terminal.writeln("\r\n[연결 오류] WebSocket 연결을 확인해 주세요."));
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    const keepAlive = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping", at: Date.now() }));
    }, 30000);
    return () => {
      window.clearInterval(keepAlive);
      input.dispose();
      resize.dispose();
      socket.close();
    };
  }, [terminalSession?.wsPath]);

  return (
    <div className="arena-preview-console">
      <div className="arena-preview-xterm" ref={rootRef} />
    </div>
  );
}
