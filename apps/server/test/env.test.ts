import { describe, expect, it } from "vitest";

import { serverEnvPaths } from "../src/env.js";

describe("serverEnvPaths", () => {
  it("points at the package-local env files", () => {
    expect(serverEnvPaths()).toEqual([
      expect.stringMatching(/apps\/server\/\.env$/),
      expect.stringMatching(/apps\/server\/\.env\.local$/)
    ]);
  });
});
