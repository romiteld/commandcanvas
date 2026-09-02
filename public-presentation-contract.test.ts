// @vitest-environment node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");
const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

const publicCopyFiles = [
  "README.md",
  "docs/devpost-submission.md",
  "components/landing/command-canvas-landing.tsx",
] as const;

describe("public presentation contract", () => {
  it("keeps Daniel Romitelli as the sole named application author under MIT", () => {
    const manifest = JSON.parse(read("package.json")) as {
      author?: string;
      license?: string;
    };
    const license = read("LICENSE");

    expect(manifest.author).toBe("Daniel Romitelli");
    expect(manifest.license).toBe("MIT");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 Daniel Romitelli");
    expect(existsSync(path.join(root, ".mailmap"))).toBe(true);
    const mailmap = existsSync(path.join(root, ".mailmap"))
      ? read(".mailmap").trim()
      : "";
    expect(mailmap).toBe(
      "Daniel Romitelli <danny.romitelli@gmail.com> Daniel Romitelli Jr. <90161013+romiteld@users.noreply.github.com>",
    );
  });

  it("tracks no repository-agent instruction file or authorship attribution", () => {
    const tracked = trackedFiles();
    const forbiddenInstructionFiles = tracked.filter((file) =>
      /(?:^|\/)(?:CLAUDE|AGENTS)\.md$/i.test(file),
    );
    const publicCopy = publicCopyFiles.map(read).join("\n");
    const commitMessages = execFileSync(
      "git",
      ["log", "--format=%B"],
      { cwd: root, encoding: "utf8" },
    );

    expect(forbiddenInstructionFiles).toEqual([]);
    expect(commitMessages).not.toMatch(/^co-authored-by:/im);
    expect(publicCopy).not.toMatch(
      /(?:ai[- ]authored|written by (?:ai|chatgpt|claude|codex)|generated (?:by|with) (?:ai|chatgpt|claude|codex))/i,
    );
  });

  it("keeps public positioning bounded and evidence-aligned", () => {
    const publicCopy = publicCopyFiles.map(read).join("\n");

    expect(publicCopy).not.toMatch(/\bfree demo\b|\bno-account\b/i);
    expect(publicCopy).not.toMatch(
      /(?:world(?:'s|’s)? first|industry(?:'s|’s)? first|first[- ]ever|unprecedented|the only (?:ai|webmcp|spatial|collaboration|workspace|canvas|application|app))/i,
    );
    expect(publicCopy).not.toMatch(
      /(?:everyone sees changes live and stays in sync|always (?:available|online|connected|synchronized|in sync)|the workspace is ready)/i,
    );
    expect(read("components/landing/command-canvas-landing.tsx")).toContain(
      "Participants see shared updates and cursors in real time while connected.",
    );
  });

  it("describes optional TURN and participant-bound media signaling accurately", () => {
    const releaseCopy = [
      read("README.md"),
      read("docs/devpost-submission.md"),
      read("docs/judge-instructions.md"),
    ].join("\n");

    expect(releaseCopy).not.toMatch(
      /(?:has|there is|with) no TURN relay|does not include TURN/i,
    );
    expect(read("README.md")).toContain("optional TURN relay");
    expect(read("docs/devpost-submission.md")).toContain(
      "room-media:<room-id>:<participant-id>",
    );
  });

  it("keeps vulnerability reporting conditional with a verifiable fallback", () => {
    const securityPolicy = read("SECURITY.md");
    const maintainerEmailMatch = read(".mailmap").match(/^[^<]+<([^>]+)>/);

    expect(securityPolicy).not.toMatch(
      /use this repository's private GitHub vulnerability-reporting channel/i,
    );
    expect(securityPolicy).toMatch(
      /if GitHub (?:shows|offers) (?:a|the) [^\n]*report a vulnerability/i,
    );
    expect(maintainerEmailMatch).not.toBeNull();
    expect(securityPolicy).toContain(
      `mailto:${maintainerEmailMatch?.[1] ?? "missing-maintainer-email"}`,
    );
  });

  it("keeps the root README concise and narrow-screen friendly", () => {
    const readme = read("README.md");
    const lineCount = readme.trimEnd().split("\n").length;

    expect(lineCount).toBeGreaterThanOrEqual(150);
    expect(lineCount).toBeLessThanOrEqual(220);
    expect(readme).not.toMatch(/```mermaid/i);
    expect(readme).not.toMatch(/^\s*\|.*\|\s*$/m);
  });

  it("resolves every local README Markdown link in the tracked release tree", () => {
    const readme = read("README.md");
    const tracked = new Set(trackedFiles());
    const localLinks = Array.from(readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))
      .map((match) => match[1].trim())
      .filter((href) => href !== "" && !href.startsWith("#"))
      .filter((href) => !/^[a-z][a-z0-9+.-]*:/i.test(href))
      .map((href) => href.split("#", 1)[0])
      .map((href) => path.posix.normalize(href.replaceAll("\\\\", "/")));

    const missing = localLinks.filter(
      (href) => href.startsWith("../") || !tracked.has(href),
    );

    expect(missing).toEqual([]);
  });
});
