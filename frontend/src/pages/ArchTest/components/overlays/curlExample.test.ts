import { describe, expect, it } from "vitest";
import type { ApiCfg } from "../../engine";
import { curlExample } from "./curlExample";

const cfg = (over: Partial<ApiCfg>): ApiCfg => ({
  method: "GET",
  path: "/users/:id",
  headers: [],
  pathParams: [],
  query: [],
  body: "",
  responses: [],
  single: false,
  responseMap: "",
  ...over,
});

describe("curlExample", () => {
  it("fills path params in both styles and adds required query params only", () => {
    const text = curlExample(
      cfg({
        path: "/a/:id/b/{slug}",
        query: [
          { k: "q", type: "string", required: true },
          { k: "skip", type: "string", required: false },
        ],
      }),
    );
    expect(text).toBe("curl -X GET https://api.example.com/a/123/b/123?q=1");
  });

  it("adds headers and a compacted body for non-GET methods", () => {
    const text = curlExample(
      cfg({ method: "POST", headers: [{ k: "Authorization", v: "Bearer t" }], body: '{\n  "a": 1\n}' }),
    );
    expect(text).toBe(
      "curl -X POST https://api.example.com/users/123 \\\n  -H \"Authorization: Bearer t\" \\\n  -d '{ \"a\": 1 }'",
    );
  });

  it("omits the body for GET", () => {
    expect(curlExample(cfg({ body: "{}" }))).not.toContain("-d");
  });
});
