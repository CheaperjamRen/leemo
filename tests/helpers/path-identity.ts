import fs from "node:fs";
import { expect } from "vitest";

export function expectSameExistingPath(actual: string | undefined, expected: string): void {
  expect(actual).toBeDefined();
  const actualStat = fs.statSync(actual!, { bigint: true });
  const expectedStat = fs.statSync(expected, { bigint: true });
  expect(
    { device: actualStat.dev, inode: actualStat.ino },
    `Expected ${actual} and ${expected} to reference the same filesystem entry`,
  ).toEqual({ device: expectedStat.dev, inode: expectedStat.ino });
}
