import { api } from "./api";

export interface DependencyError {
  package: string;
  reason: string;
  kind: "not_allowed" | "install_failed";
}

export interface RunSimpleResult {
  exec_id: string;
  language: string;
  block_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
  dependency_error?: DependencyError | null;
}

export type RCEEvent =
  | { event_type: "stdout"; exec_id: string; line: string }
  | { event_type: "stderr"; exec_id: string; line: string }
  | { event_type: "exit"; exec_id: string; exit_code: number; timed_out: boolean; duration_ms: number }
  | { event_type: "error"; exec_id: string; message: string }
  | ({ event_type: "dependency_error"; exec_id: string } & DependencyError);

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
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch("/api/v1/rce/execute/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, language }),
    signal,
  });

  if (!resp.ok) throw new Error(`stream request failed (${resp.status})`);
  if (!resp.body) throw new Error("stream response has no body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
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
        } catch (err) {
          console.warn("skipping malformed stream frame:", line, err);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => { /* stream already closed */ });
  }
}
