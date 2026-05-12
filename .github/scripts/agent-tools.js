/**
 * .github/scripts/agent-tools.js
 *
 * Shared tool definitions and execution for the MQL spec agents.
 * Used by both generate-pr.js and fix-pr.js.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DOCS_REPO_PRIVATE = "10gen/docs-mongodb-internal";
const DOCS_REPO_PUBLIC = "mongodb/docs";

const {
  DOCS_GITHUB_TOKEN,
  GITHUB_TOKEN,
  GITHUB_WORKSPACE = ".",
} = process.env;

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function githubHeaders(repo) {
  const token = repo.startsWith("10gen/") ? DOCS_GITHUB_TOKEN : GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search_docs",
    description:
      "Search for an operator documentation file (.txt or .rst) across MongoDB docs repos. " +
      "Searches in this order: (1) 10gen/docs-mongodb-internal main branch, " +
      "(2) 10gen/docs-mongodb-internal open PRs, " +
      "(3) mongodb/docs main branch, " +
      "(4) mongodb/docs open PRs. " +
      "Returns a list of matches with repo, path, and ref (branch name).",
    input_schema: {
      type: "object",
      properties: {
        operator: { type: "string", description: "Operator name without $, e.g. 'rerank', 'match', 'convert'." },
      },
      required: ["operator"],
    },
  },
  {
    name: "fetch_docs_file",
    description: "Fetch the raw RST/txt content of a documentation file from a GitHub docs repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "GitHub repo, e.g. '10gen/docs-mongodb-internal' or 'mongodb/docs'." },
        path: { type: "string", description: "File path in the repo." },
        ref: { type: "string", description: "Branch name or 'main'." },
      },
      required: ["repo", "path", "ref"],
    },
  },
  {
    name: "list_files",
    description: "List YAML spec files in a definitions subdirectory of the repository.",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Relative path from repo root, e.g. 'definitions/stage'." },
      },
      required: ["directory"],
    },
  },
  {
    name: "read_file",
    description: "Read the content of a file in the repository.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root, e.g. 'definitions/stage/match.yaml'." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a YAML spec file to the repository.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root." },
        content: { type: "string", description: "Full YAML content to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "validate_spec",
    description:
      "Run local validations on spec files: yamlfix (formatting) and the JSON schema validator. " +
      "Call this after writing files to catch errors before committing. " +
      "Returns stdout/stderr output and whether validation passed. " +
      "Note: yamlfix is scoped to provided paths; JSON schema validation always runs on the entire definitions tree.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "List of relative file paths to scope yamlfix, e.g. ['definitions/stage/rerank.yaml']. Leave empty to validate all definitions.",
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name, input) {
  switch (name) {
    case "search_docs": {
      const { operator } = input;
      const results = [];
      const repos = [
        DOCS_REPO_PRIVATE,
        DOCS_REPO_PUBLIC,
      ];

      for (const repo of repos) {
        if (repo === DOCS_REPO_PRIVATE && !DOCS_GITHUB_TOKEN) continue;

        // Search on main branch for both .txt and .rst
        for (const ext of ["txt", "rst"]) {
          const searchRes = await fetch(
            `https://api.github.com/search/code?q=filename:${operator}.${ext}+repo:${repo}`,
            { headers: githubHeaders(repo) }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            for (const item of data.items ?? []) {
              results.push({ repo, path: item.path, ref: "main" });
            }
          }
        }

        // If not on main, scan open PRs
        if (!results.some((r) => r.repo === repo)) {
          const prsRes = await fetch(
            `https://api.github.com/repos/${repo}/pulls?state=open&per_page=30`,
            { headers: githubHeaders(repo) }
          );
          if (prsRes.ok) {
            for (const pr of await prsRes.json()) {
              const filesRes = await fetch(
                `https://api.github.com/repos/${repo}/pulls/${pr.number}/files`,
                { headers: githubHeaders(repo) }
              );
              if (!filesRes.ok) continue;
              const match = (await filesRes.json()).find(
                (f) => f.filename.endsWith(`/${operator}.txt`) || f.filename.endsWith(`/${operator}.rst`)
              );
              if (match) {
                results.push({ repo, path: match.filename, ref: pr.head.ref, pr: pr.number });
                break;
              }
            }
          }
        }

        if (results.length > 0) break; // Found — skip lower-priority repo
      }

      return results.length ? { results } : { results: [], note: "Not found in any docs repo." };
    }

    case "fetch_docs_file": {
      const { repo, path: filePath, ref } = input;
      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${ref}`,
        { headers: { ...githubHeaders(repo), Accept: "application/vnd.github.raw" } }
      );
      if (!res.ok) return { error: `GitHub API ${res.status}: ${await res.text()}` };
      return { content: (await res.text()).slice(0, 30000) };
    }

    case "list_files": {
      const dir = path.join(GITHUB_WORKSPACE, input.directory);
      if (!fs.existsSync(dir)) return { error: `Directory not found: ${input.directory}` };
      return { files: fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")) };
    }

    case "read_file": {
      const filePath = path.join(GITHUB_WORKSPACE, input.path);
      if (!fs.existsSync(filePath)) return { error: `File not found: ${input.path}` };
      return { content: fs.readFileSync(filePath, "utf8") };
    }

    case "write_file": {
      const filePath = path.join(GITHUB_WORKSPACE, input.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const content = input.content.endsWith("\n") ? input.content : input.content + "\n";
      fs.writeFileSync(filePath, content, "utf8");
      return { success: true, path: input.path };
    }

    case "validate_spec": {
      const results = {};
      const targetPaths = (input.paths ?? []).map((p) => path.join(GITHUB_WORKSPACE, p));
      const yamlTargets = targetPaths.length ? targetPaths.join(" ") : path.join(GITHUB_WORKSPACE, "definitions");

      // yamlfix
      try {
        const yamlOut = execSync(`yamlfix --check ${yamlTargets} 2>&1`, { encoding: "utf8", cwd: GITHUB_WORKSPACE });
        results.yamlfix = { passed: true, output: yamlOut || "OK" };
      } catch (e) {
        results.yamlfix = { passed: false, output: e.stdout || e.message };
      }

      // JSON schema validator
      try {
        const validateOut = execSync("pnpm run validate 2>&1", {
          encoding: "utf8",
          cwd: path.join(GITHUB_WORKSPACE, "scripts/schema-validator"),
        });
        results.schema = { passed: true, output: validateOut || "OK" };
      } catch (e) {
        results.schema = { passed: false, output: e.stdout || e.message };
      }

      results.allPassed = results.yamlfix.passed && results.schema.passed;
      return results;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Claude agentic loop
// ---------------------------------------------------------------------------

async function runAgentLoop({ systemPrompt, userMessage, extraTools = [], executeToolFn = executeTool, groveApiKey, maxIterations = 20 }) {
  const tools = [...TOOLS, ...extraTools];
  const messages = [{ role: "user", content: userMessage }];

  for (let i = 0; i < maxIterations; i++) {
    const res = await fetch(
      "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": groveApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
        }),
      }
    );

    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const response = await res.json();
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      return response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    }

    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`→ Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 120));
        const result = await executeToolFn(block.name, block.input);
        console.log(`← Result:`, JSON.stringify(result).slice(0, 120));
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  throw new Error("Agent reached max iterations without completing");
}

module.exports = { TOOLS, executeTool, runAgentLoop };
