import { describe, expect, it } from "vitest";
import { importCompletionSpot, listImportedPackages } from "./imports";

describe("importCompletionSpot (python)", () => {
  it("detects `import re`", () => {
    const spot = importCompletionSpot("import re", "python");
    expect(spot).toEqual({ from: 7, prefix: "re" });
  });

  it("detects `from re`", () => {
    const spot = importCompletionSpot("from re", "python");
    expect(spot).toEqual({ from: 5, prefix: "re" });
  });

  it("ignores the names after `from x import`", () => {
    expect(importCompletionSpot("from os import pa", "python")).toBeNull();
  });

  it("ignores code outside an import", () => {
    expect(importCompletionSpot("x = re", "python")).toBeNull();
  });
});

describe("importCompletionSpot (javascript)", () => {
  it("detects require()", () => {
    const spot = importCompletionSpot("const a = require('ax", "javascript");
    expect(spot?.prefix).toBe("ax");
  });

  it("detects `from '...'`", () => {
    const spot = importCompletionSpot("import x from 'lod", "javascript");
    expect(spot?.prefix).toBe("lod");
  });
});

describe("listImportedPackages (python)", () => {
  it("finds import, from, and multi-import; drops relative + submodule", () => {
    const code =
      "import numpy\nfrom pandas import DataFrame\nimport os, sys\nfrom . import util\nimport numpy.linalg";
    const names = listImportedPackages(code, "python").map((p) => p.name);
    expect(names).toContain("numpy");
    expect(names).toContain("pandas");
    expect(names).toContain("os");
    expect(names).toContain("sys");
    expect(names).not.toContain("util"); // relative
    expect(names).not.toContain("numpy.linalg"); // reduced to top-level
  });

  it("reports the correct range for the underline", () => {
    const [pkg] = listImportedPackages("import numpy", "python");
    expect(pkg).toMatchObject({ name: "numpy", from: 7, to: 12 });
  });
});

describe("listImportedPackages (javascript)", () => {
  it("finds require and import specifiers; keeps scope, drops relative", () => {
    const code =
      "const a = require('axios');\nimport _ from 'lodash/fp';\nimport x from './local';\nimport s from '@scope/pkg';";
    const names = listImportedPackages(code, "javascript").map((p) => p.name);
    expect(names).toContain("axios");
    expect(names).toContain("lodash"); // subpath reduced to package
    expect(names).toContain("@scope/pkg"); // scope preserved
    expect(names).not.toContain("./local");
  });
});
