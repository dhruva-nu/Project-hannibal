import { describe, expect, it } from "vitest";
import {
  APP_STEP_KINDS,
  STEP_KIND_OPTIONS,
  newAppService,
  newAppServiceCall,
  newAppStep,
  newEndpoint,
  newQueryCall,
  normalize,
  starter,
  stepSummary,
  type ServiceNode,
} from "./index";

const serviceOf = (model: ReturnType<typeof starter>) => model.nodes.find((n) => n.type === "service") as ServiceNode;

describe("in-app services", () => {
  it("lists every step kind as an option", () => {
    expect(STEP_KIND_OPTIONS).toHaveLength(Object.keys(APP_STEP_KINDS).length);
  });

  it("summarises a step with and without a target", () => {
    expect(stepSummary(newAppStep("s3-get"))).toBe("Fetch from S3");
    expect(stepSummary({ ...newAppStep("redis-set"), target: "user:1" })).toBe("Write to Redis: user:1");
  });

  it("builds calls for queries and in-app services", () => {
    expect(newQueryCall().kind).toBe("query");
    expect(newAppServiceCall("as_1")).toMatchObject({ kind: "appService", appServiceId: "as_1" });
    expect(newAppService("cache user").steps).toEqual([]);
  });

  it("gives new endpoints a query call", () => {
    expect(newEndpoint().calls.map((c) => c.kind)).toEqual(["query"]);
  });
});

describe("normalize and in-app services", () => {
  it("backfills services saved before in-app services existed", () => {
    const model = starter();
    const service = serviceOf(model);
    delete (service.cfg as Partial<typeof service.cfg>).appServices;
    service.cfg.endpoints.forEach((e) => delete (e as Partial<typeof e>).calls);
    normalize(model);
    expect(service.cfg.appServices).toEqual([]);
    expect(service.cfg.endpoints.every((e) => e.calls.length === 1)).toBe(true);
  });

  it("drops calls to in-app services that no longer exist", () => {
    const model = starter();
    const service = serviceOf(model);
    const kept = newAppService("kept");
    service.cfg.appServices = [kept];
    service.cfg.endpoints[0].calls = [newAppServiceCall(kept.id), newAppServiceCall("gone")];
    normalize(model);
    expect(service.cfg.endpoints[0].calls.map((c) => c.appServiceId)).toEqual([kept.id]);
  });
});
