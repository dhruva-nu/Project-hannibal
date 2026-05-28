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

export function runSimple(code: string, language: string, blockId: string): Promise<RunSimpleResult> {
  return api.post<RunSimpleResult>("/api/v1/run-code/run-simple", {
    code,
    language,
    block_id: blockId,
  });
}
