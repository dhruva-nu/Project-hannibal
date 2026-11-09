import { uid } from "./json";
import type { AppService, AppStep, AppStepKind, EndpointCall } from "./types";

interface StepKindInfo {
  label: string;
  targetLabel: string;
  targetPlaceholder: string;
}

/** Add a new kind of in-app step here and it appears in the editor automatically. */
export const APP_STEP_KINDS: Record<AppStepKind, StepKindInfo> = {
  "db-read": { label: "Read from database", targetLabel: "Table / collection", targetPlaceholder: "users" },
  "db-write": { label: "Write to database", targetLabel: "Table / collection", targetPlaceholder: "users" },
  "s3-get": { label: "Fetch from S3", targetLabel: "Bucket / key", targetPlaceholder: "uploads/avatar.png" },
  "s3-put": { label: "Upload to S3", targetLabel: "Bucket / key", targetPlaceholder: "uploads/avatar.png" },
  "redis-get": { label: "Read from Redis", targetLabel: "Cache key", targetPlaceholder: "user:{id}" },
  "redis-set": { label: "Write to Redis", targetLabel: "Cache key", targetPlaceholder: "user:{id}" },
  "http-call": { label: "Call external API", targetLabel: "URL", targetPlaceholder: "https://api.example.com/v1" },
  custom: { label: "Custom logic", targetLabel: "Name", targetPlaceholder: "transformResult" },
};

export const STEP_KIND_OPTIONS = (Object.keys(APP_STEP_KINDS) as AppStepKind[]).map(
  (kind) => [kind, APP_STEP_KINDS[kind].label] as const,
);

export const newAppStep = (kind: AppStepKind = "db-read"): AppStep => ({ id: uid("st"), kind, target: "", detail: "" });

export const newAppService = (name: string): AppService => ({ id: uid("as"), name, steps: [] });

export const newQueryCall = (): EndpointCall => ({ id: uid("call"), kind: "query", appServiceId: "" });

export const newAppServiceCall = (appServiceId: string): EndpointCall => ({
  id: uid("call"),
  kind: "appService",
  appServiceId,
});

export const stepSummary = (step: AppStep): string => {
  const info = APP_STEP_KINDS[step.kind];
  return step.target ? `${info.label}: ${step.target}` : info.label;
};
