import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const sourceRoots = [
  "src",
  "packages/knowledge-access/src",
  "packages/memory-system/src",
  "packages/queue/src",
  "packages/simple-pomdp-system/src",
];

const collectSource = (relativeRoot: string): string => {
  const absoluteRoot = path.join(process.cwd(), relativeRoot);
  if (!existsSync(absoluteRoot)) {
    throw new Error(`architecture source is missing: ${relativeRoot}`);
  }
  return readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|md|json)$/u.test(entry.name))
    .map((entry) =>
      readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
    )
    .join("\n");
};

test("removed packages, stores, fields, scores, and compatibility paths stay absent", () => {
  const source = [
    ...sourceRoots.map(collectSource),
    readFileSync(
      path.join(process.cwd(), "packages/simple-pomdp-system/README.md"),
      "utf8",
    ),
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ].join("\n");
  const removedSymbols = [
    ["relationship", "system"].join("-"),
    ["do", "nothing"].join("_"),
    ["TurnRecord", "Store"].join(""),
    ["probe", "Type"].join(""),
    ["initiation", "Tolerance"].join(""),
    ["attempt", "Count"].join(""),
    ["positive", "Count"].join(""),
    ["negative", "Count"].join(""),
  ];

  for (const symbol of removedSymbols) {
    expect(source).not.toContain(symbol);
  }
  expect(
    existsSync(
      path.join(
        process.cwd(),
        "packages",
        ["relationship", "system"].join("-"),
      ),
    ),
  ).toBe(false);
  expect(
    existsSync(
      path.join(
        process.cwd(),
        "src/infrastructure/agent",
        ["langchain", "Compat.ts"].join(""),
      ),
    ),
  ).toBe(false);
});
