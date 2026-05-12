/**
 * .github/scripts/generate-pr.js
 *
 * Agentic Claude script that:
 *  1. Fetches the full Jira ticket
 *  2. Gives Claude tools to read MongoDB docs and existing spec files
 *  3. Claude generates and writes the YAML spec file(s)
 *  4. Outputs branch_name and pr_title for the workflow
 *
 * No npm install needed — uses Node.js built-in fetch + fs (v18+).
 */

const fs = require("fs");
const path = require("path");

const { GROVE_API_KEY, JIRA_PAT, JIRA_KEY, GITHUB_OUTPUT, GITHUB_WORKSPACE = "." } = process.env;

if (!GROVE_API_KEY) throw new Error("Missing GROVE_API_KEY secret");
if (!JIRA_PAT) throw new Error("Missing JIRA_PAT secret");
if (!JIRA_KEY) throw new Error("Missing JIRA_KEY input");

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

async function fetchJiraTicket(key) {
  const url = `https://jira.mongodb.org/rest/api/2/issue/${key}?fields=summary,description,issuetype,priority,assignee,components,labels`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${JIRA_PAT}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
  const { fields } = await res.json();
  return {
    key,
    summary: fields.summary,
    description: fields.description || "No description provided.",
    type: fields.issuetype?.name ?? "Task",
    priority: fields.priority?.name ?? "Medium",
    assignee: fields.assignee?.displayName ?? "Unassigned",
    components: (fields.components ?? []).map((c) => c.name).join(", ") || "None",
    labels: (fields.labels ?? []).join(", ") || "None",
  };
}

// ---------------------------------------------------------------------------
// Tools available to Claude
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "fetch_url",
    description:
      "Fetch the content of a URL (MongoDB documentation page or any HTTP resource). " +
      "For MongoDB docs, try https://www.mongodb.com/docs/manual/... first, then replace 'manual' with 'upcoming' if the page returns 404.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch." },
      },
      required: ["url"],
    },
  },
  {
    name: "list_files",
    description: "List YAML spec files in a definitions subdirectory of the repository.",
    input_schema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description:
            "Relative path from repo root, e.g. 'definitions/stage' or 'definitions/expression'.",
        },
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
        path: {
          type: "string",
          description: "Relative path from repo root, e.g. 'definitions/stage/match.yaml'.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write a YAML spec file to the repository. Use this to create or update an operator spec. " +
      "The path should be relative to the repo root.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from repo root, e.g. 'definitions/stage/vectorSearch.yaml'.",
        },
        content: {
          type: "string",
          description: "Full YAML content to write.",
        },
      },
      required: ["path", "content"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name, input) {
  switch (name) {
    case "fetch_url": {
      const res = await fetch(input.url, {
        headers: { "User-Agent": "mql-spec-agent/1.0" },
      });
      const text = await res.text();
      // Return first 20000 chars to avoid bloating context
      return { status: res.status, body: text.slice(0, 20000) };
    }

    case "list_files": {
      const dir = path.join(GITHUB_WORKSPACE, input.directory);
      if (!fs.existsSync(dir)) return { error: `Directory not found: ${input.directory}` };
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"));
      return { files };
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

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Claude agentic loop
// ---------------------------------------------------------------------------

async function runAgent(ticket) {
  const systemPrompt = `You are an expert agent for the MongoDB MQL Specifications repository.
Your task is to create or update YAML operator spec files based on a Jira ticket and MongoDB documentation.

Repository structure:
- definitions/stage/      — aggregation pipeline stages ($match, $group, $sort, etc.)
- definitions/expression/ — expression operators ($abs, $add, $multiply, etc.)
- definitions/accumulator/ — accumulator operators ($sum, $avg, etc.)
- definitions/query/       — query operators ($eq, $gt, $in, etc.)
- definitions/update/      — update operators ($set, $inc, etc.)
- definitions/types/       — shared types

YAML spec format (schemas/operator.json):
- name: operator name starting with $
- link: MongoDB docs URL
- minVersion: minimum MongoDB version (e.g. '8.0')
- type: array of return types (stage, expression, resolvesToNumber, etc.)
- encode: 'array' | 'object' | 'single'
- description: description from MongoDB docs
- arguments: list of arguments with name, type, optional, description
- tests: list of examples with name, link, pipeline

Rules:
- Always read at least one existing similar spec before writing
- Fetch the MongoDB documentation page to get the accurate description, arguments, and examples
- Try https://www.mongodb.com/docs/manual/... first; if 404, try replacing 'manual' with 'upcoming'
- The YAML must start with: # $schema: ../../schemas/operator.json
- End the file with a newline
- After writing all files, output a JSON summary on the last line:
  {"branchName": "drivers-XXXX-short-description", "prTitle": "[DRIVERS-XXXX] Short description", "filesWritten": ["path/to/file.yaml"]}`;

  const userMessage = `Jira ticket: ${ticket.key}
Summary: ${ticket.summary}
Type: ${ticket.type}
Priority: ${ticket.priority}
Components: ${ticket.components}
Description:
${ticket.description}

Please fetch the relevant MongoDB documentation, read similar existing specs for format reference, then generate and write the appropriate YAML spec file(s).`;

  const messages = [{ role: "user", content: userMessage }];
  let summary = null;

  for (let iteration = 0; iteration < 20; iteration++) {
    const res = await fetch(
      "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": GROVE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
      }
    );

    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const response = await res.json();

    // Add assistant turn to messages
    messages.push({ role: "assistant", content: response.content });

    // Check for final text response (contains JSON summary)
    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      console.log("Agent response:\n", text);
      // Extract JSON summary from last line
      const lines = text.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          summary = JSON.parse(lines[i]);
          break;
        } catch {}
      }
      break;
    }

    // Process tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`→ Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 120));
        const result = await executeTool(block.name, block.input);
        console.log(`← Result:`, JSON.stringify(result).slice(0, 120));
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  if (!summary) throw new Error("Agent did not produce a JSON summary");
  return summary;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function sanitizeBranchName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_.\/]/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

function setOutput(key, value) {
  const delimiter = `EOF_${Date.now()}`;
  fs.appendFileSync(GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    console.log(`Fetching Jira ticket ${JIRA_KEY}...`);
    const ticket = await fetchJiraTicket(JIRA_KEY);
    console.log(`Running agent for: ${ticket.summary}`);

    const { branchName, prTitle, filesWritten } = await runAgent(ticket);

    const safeBranch = sanitizeBranchName(branchName);
    console.log(`Branch: ${safeBranch}`);
    console.log(`PR title: ${prTitle}`);
    console.log(`Files written: ${(filesWritten ?? []).join(", ")}`);

    setOutput("branch_name", safeBranch);
    setOutput("pr_title", prTitle);
    setOutput("files_written", (filesWritten ?? []).join(" "));

    console.log("Outputs written to GITHUB_OUTPUT ✅");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
