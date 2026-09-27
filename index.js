#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const execFileAsync = promisify(execFile);

function ensureRepo(repoPath) {
  if (!repoPath || typeof repoPath !== "string") {
    throw new Error("repoPath is required");
  }

  if (!fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error(`Not a git repo: ${repoPath}`);
  }
}

async function runGit(repoPath, args, stdoutOnly = false) {
  ensureRepo(repoPath);

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["-C", repoPath, ...args],
      {
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (stdoutOnly) {
      return (stdout || "").trim();
    }
    return `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();
  } catch (error) {
    const message = [error.stderr, error.stdout, error.message]
      .filter(Boolean)
      .join("\n");
    if (stdoutOnly) {
      throw new Error(
        (error.stderr || error.message || "git command failed").trim(),
      );
    }
    throw new Error(message.trim() || "git command failed");
  }
}

async function getFileAtCommit(repoPath, filePath, ref) {
  return runGit(repoPath, ["show", `${ref}:${filePath}`], true);
}

async function listCommitsForFile(repoPath, filePath, maxCount) {
  const args = ["log", "--follow"];
  if (maxCount != null && Number.isFinite(Number(maxCount))) {
    args.push("-n", String(Number(maxCount)));
  }
  args.push("--format=%H%x09%an%x09%ad%x09%s", "--date=short", "--", filePath);
  return runGit(repoPath, args);
}

async function blameLineRange(repoPath, filePath, startLine, endLine, ref) {
  const args = ["blame"];
  if (ref) {
    args.push(ref);
  }
  args.push("-L", `${startLine},${endLine}`, "--", filePath);
  return runGit(repoPath, args);
}

async function diffBetweenCommits(repoPath, refA, refB, filePath) {
  const args = ["diff", refA, refB];
  if (filePath) {
    args.push("--", filePath);
  }
  return runGit(repoPath, args);
}

async function findIntroducingCommit(
  repoPath,
  filePath,
  testCommand,
  goodRef,
  badRef,
) {
  ensureRepo(repoPath);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pastcode-bisect-"));
  const worktreePath = path.join(tempRoot, "repo");

  try {
    await runGit(repoPath, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      goodRef,
    ]);
    await runGit(worktreePath, ["bisect", "start"]);
    await runGit(worktreePath, ["bisect", "bad", badRef]);
    await runGit(worktreePath, ["bisect", "good", goodRef]);

    const bisectOutput = await execFileAsync(
      "git",
      ["-C", worktreePath, "bisect", "run", "bash", "-lc", testCommand],
      { maxBuffer: 20 * 1024 * 1024 },
    );

    const head = await runGit(worktreePath, ["rev-parse", "HEAD"]);
    const summary = [
      `Introduced by commit: ${head}`,
      `File: ${filePath || "(not restricted)"}`,
      "",
      bisectOutput.stdout || bisectOutput.stderr || "",
    ].join("\n");

    return summary.trim();
  } catch (error) {
    const msg = [error.stderr, error.stdout, error.message]
      .filter(Boolean)
      .join("\n");
    throw new Error(msg.trim() || "bisect failed");
  } finally {
    try {
      if (fs.existsSync(worktreePath)) {
        try {
          await runGit(worktreePath, ["bisect", "reset"]);
        } catch (cleanupError) {
          // ignore bisect reset failures so the worktree can still be removed
        }
        await runGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
      }
    } catch (cleanupError) {
      // ignore cleanup errors during short-lived tooling
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const server = new Server(
  { name: "pastcode", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_file_at_commit",
      description: "Return the contents of a file at a specific commit or ref.",
      inputSchema: {
        type: "object",
        properties: {
          repoPath: { type: "string" },
          path: { type: "string" },
          ref: { type: "string" },
        },
        required: ["repoPath", "path", "ref"],
      },
    },
    {
      name: "list_commits_for_file",
      description: "List recent commits affecting a file.",
      inputSchema: {
        type: "object",
        properties: {
          repoPath: { type: "string" },
          path: { type: "string" },
          maxCount: { type: "number" },
        },
        required: ["repoPath", "path"],
      },
    },
    {
      name: "blame_line_range",
      description: "Blame a line range in a file.",
      inputSchema: {
        type: "object",
        properties: {
          repoPath: { type: "string" },
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
          ref: { type: "string" },
        },
        required: ["repoPath", "path", "startLine", "endLine"],
      },
    },
    {
      name: "diff_between_commits",
      description: "Show the diff between two refs for a file or repo.",
      inputSchema: {
        type: "object",
        properties: {
          repoPath: { type: "string" },
          refA: { type: "string" },
          refB: { type: "string" },
          path: { type: "string" },
        },
        required: ["repoPath", "refA", "refB"],
      },
    },
    {
      name: "find_introducing_commit",
      description:
        "Use git bisect in a temporary worktree to find the introducing commit for a bug.",
      inputSchema: {
        type: "object",
        properties: {
          repoPath: { type: "string" },
          path: { type: "string" },
          testCommand: { type: "string" },
          goodRef: { type: "string" },
          badRef: { type: "string" },
        },
        required: ["repoPath", "path", "testCommand", "goodRef", "badRef"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result;

    switch (name) {
      case "get_file_at_commit":
        result = await getFileAtCommit(args.repoPath, args.path, args.ref);
        break;
      case "list_commits_for_file":
        result = await listCommitsForFile(
          args.repoPath,
          args.path,
          args.maxCount,
        );
        break;
      case "blame_line_range":
        result = await blameLineRange(
          args.repoPath,
          args.path,
          args.startLine,
          args.endLine,
          args.ref,
        );
        break;
      case "diff_between_commits":
        result = await diffBetweenCommits(
          args.repoPath,
          args.refA,
          args.refB,
          args.path,
        );
        break;
      case "find_introducing_commit":
        result = await findIntroducingCommit(
          args.repoPath,
          args.path,
          args.testCommand,
          args.goodRef,
          args.badRef,
        );
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: String(result) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: String(error.message || error) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
