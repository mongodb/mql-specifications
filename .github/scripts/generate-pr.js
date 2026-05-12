/**
 * .github/scripts/generate-pr.js
 *
 * Fetches a Jira ticket, then runs an agentic Claude loop to generate
 * YAML MQL spec files from MongoDB documentation.
 */

const fs = require("fs");
const { runAgentLoop } = require("./agent-tools");

const { GROVE_API_KEY, JIRA_PAT, JIRA_KEY, AGENT_MODE = "create", GITHUB_OUTPUT } = process.env;

if (!GROVE_API_KEY) throw new Error("Missing GROVE_API_KEY secret");
if (!JIRA_PAT) throw new Error("Missing JIRA_PAT secret");
if (!JIRA_KEY) throw new Error("Missing JIRA_KEY input");

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

const SYSTEM_PROMPT = `You are an expert agent for the MongoDB MQL Specifications repository.
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

Documentation sources (in priority order):
1. Private repo 10gen/docs-mongodb-internal — most up-to-date, includes unreleased content
2. Public repo mongodb/docs — fallback if not found in private repo
Use search_docs to locate the file, then fetch_docs_file to read its RST content.

Rules:
- Always read at least one existing similar spec before writing
- Always use search_docs + fetch_docs_file to get documentation (RST is cleaner than HTML)
- If search_docs returns no results in any repo, output this JSON and stop:
  {"error": "no_docs_found", "reason": "brief explanation"}
- After writing files, call validate_spec to check for errors and fix them if needed
- The 'link' field must ALWAYS use https://www.mongodb.com/docs/manual/..., never 'upcoming'
- The YAML must start with: # $schema: ../../schemas/operator.json
- End the file with a newline
- After writing and validating all files, output a JSON summary on the last line:
  {"branchName": "drivers-XXXX-short-description", "prTitle": "[DRIVERS-XXXX] Short description", "filesWritten": ["path/to/file.yaml"]}`;

function sanitizeBranchName(name) {
  return name.toLowerCase().replace(/[^a-z0-9\-_.\/]/g, "-").replace(/-{2,}/g, "-").slice(0, 60);
}

function setOutput(key, value) {
  const delimiter = `EOF_${Date.now()}`;
  fs.appendFileSync(GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}

(async () => {
  try {
    console.log(`Fetching Jira ticket ${JIRA_KEY}...`);
    const ticket = await fetchJiraTicket(JIRA_KEY);
    console.log(`Running agent for: ${ticket.summary}`);

    const isUpdate = AGENT_MODE === "update";
    const userMessage = `Jira ticket: ${ticket.key}
Summary: ${ticket.summary}
Type: ${ticket.type} | Priority: ${ticket.priority} | Components: ${ticket.components}
Description:
${ticket.description}

${isUpdate
  ? "A spec file already exists for this ticket. Read the current spec, fetch the latest documentation, and update the file only if there are meaningful differences (new arguments, updated description, new examples). If nothing has changed, do not write the file."
  : "Search for the operator documentation, read similar existing specs for format reference, generate and write the YAML spec file(s), validate them, then output the JSON summary."
}

Output a JSON summary on the last line:
{"branchName": "drivers-XXXX-short-description", "prTitle": "[DRIVERS-XXXX] Short description", "filesWritten": ["path/to/file.yaml"]}`;

    const text = await runAgentLoop({ systemPrompt: SYSTEM_PROMPT, userMessage, groveApiKey: GROVE_API_KEY });
    console.log("Agent response:\n", text);

    // Extract JSON summary from last line
    let summary = null;
    for (const line of text.trim().split("\n").reverse()) {
      try { summary = JSON.parse(line); break; } catch {}
    }
    if (!summary) throw new Error("Agent did not produce a JSON summary");

    if (summary.error === "no_docs_found") {
      console.error(`No documentation found: ${summary.reason}`);
      process.exit(1);
    }

    const { branchName, prTitle, filesWritten } = summary;
    const expectedPrefix = JIRA_KEY.toLowerCase() + "-";
    const rawBranch = branchName.toLowerCase().startsWith(expectedPrefix)
      ? branchName
      : `${expectedPrefix}${branchName}`;
    const safeBranch = sanitizeBranchName(rawBranch);
    console.log(`Branch: ${safeBranch} | PR: ${prTitle} | Files: ${(filesWritten ?? []).join(", ")}`);

    setOutput("branch_name", safeBranch);
    setOutput("pr_title", prTitle);
    setOutput("files_written", (filesWritten ?? []).join(" "));
    console.log("Outputs written to GITHUB_OUTPUT ✅");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
