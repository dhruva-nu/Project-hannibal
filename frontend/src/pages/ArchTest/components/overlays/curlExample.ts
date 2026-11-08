import type { ApiCfg } from "../../engine";

const PATH_PARAMETER = /:(\w+)|\{(\w+)\}/g;
const SAMPLE_PARAMETER_VALUE = "123";

export const curlExample = (cfg: ApiCfg): string => {
  const path = cfg.path.replace(PATH_PARAMETER, SAMPLE_PARAMETER_VALUE);
  const query = cfg.query
    .filter((param) => param.required)
    .map((param) => `${param.k}=1`)
    .join("&");
  const headers = cfg.headers.map((header) => ` \\\n  -H "${header.k}: ${header.v}"`).join("");
  const body = cfg.body && cfg.method !== "GET" ? ` \\\n  -d '${cfg.body.replace(/\s+/g, " ")}'` : "";
  return `curl -X ${cfg.method} https://api.example.com${path}${query ? `?${query}` : ""}${headers}${body}`;
};
