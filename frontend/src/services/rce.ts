import { api } from "./api";

export interface RunSimpleResult {
  exec_id: string;
  language: string;
  block_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
}

export type RCEEvent =
  | { event_type: "stdout"; exec_id: string; line: string }
  | { event_type: "stderr"; exec_id: string; line: string }
  | { event_type: "exit"; exec_id: string; exit_code: number; timed_out: boolean; duration_ms: number }
  | { event_type: "error"; exec_id: string; message: string };

export function runSimple(code: string, language: string, blockId: string): Promise<RunSimpleResult> {
  return api.post<RunSimpleResult>("/api/v1/run-code/run-simple", {
    code,
    language,
    block_id: blockId,
  });
}

export async function streamExecute(
  code: string,
  language: string,
  onEvent: (event: RCEEvent) => void,
): Promise<void> {
  const resp = await fetch("/api/v1/rce/execute/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, language }),
  });

  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as RCEEvent);
      } catch { /* skip malformed frames */ }
    }
  }
}
