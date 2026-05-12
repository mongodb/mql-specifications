/**
 * .github/scripts/generate-pr.js
 *
 * Fetches full Jira ticket data, calls Claude via Grove Gateway,
 * and writes branch/PR content to $GITHUB_OUTPUT.
 *
 * No npm install needed — uses Node.js built-in fetch (v18+).
 */

const {
  GROVE_API_KEY,
  JIRA_PAT,
  JIRA_KEY,
  GITHUB_OUTPUT,
} = process.env;

if (!GROVE_API_KEY) throw new Error("Missing GROVE_API_KEY secret");
if (!JIRA_PAT) throw new Error("Missing JIRA_PAT secret");
if (!JIRA_KEY) throw new Error("Missing JIRA_KEY input");

async function fetchJiraTicket(key) {
  const url = `https://jira.mongodb.org/rest/api/2/issue/${key}?fields=summary,description,issuetype,priority,assignee,components,labels,comment`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${JIRA_PAT}`,
      "Accept": "application/json",
    },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jira API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const f = data.fields;
  return {
    key,
    summary: f.summary,
    description: f.description || "No description provided.",
    type: f.issuetype?.name ?? "Task",
    priority: f.priority?.name ?? "Medium",
    assignee: f.assignee?.displayName ?? "Unassigned",
    components: (f.components ?? []).map((c) => c.name).join(", ") || "None",
    labels: (f.labels ?? []).join(", ") || "None",
  };
}

async function callClaude(ticket) {
  const prompt = `You are a developer assistant working on the MongoDB MQL Specifications repository.
Given a Jira ticket, generate:
1. A Git branch name (kebab-case, max 60 chars, starts with the ticket key in lowercase, e.g. drivers-3300-short-description)
2. A Pull Request title (concise, starts with the ticket key in brackets, e.g. [DRIVERS-3300] Short description)
3. A Pull Request description in Markdown with sections:
   - ## Summary (1-2 sentences describing the MQL spec change)
   - ## Changes (bullet list of expected specification files or operators to add/update)
   - ## Testing (basic checklist)
   - ## Jira
     Link: https://jira.mongodb.org/browse/${ticket.key}

Ticket details:
- Key: ${ticket.key}
- Type: ${ticket.type}
- Priority: ${ticket.priority}
- Assignee: ${ticket.assignee}
- Components: ${ticket.components}
- Labels: ${ticket.labels}
- Summary: ${ticket.summary}
- Description: ${ticket.description}

Respond ONLY with a valid JSON object (no markdown fences, no preamble):
{
  "branchName": "...",
  "prTitle": "...",
  "prBody": "..."
}`;

  const response = await fetch("https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": GROVE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const clean = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(clean);
}

function sanitizeBranchName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_.\/]/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

function setOutput(key, value) {
  const fs = require("fs");
  const delimiter = `EOF_${Date.now()}`;
  fs.appendFileSync(GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}

(async () => {
  try {
    console.log(`Fetching Jira ticket ${JIRA_KEY}...`);
    const ticket = await fetchJiraTicket(JIRA_KEY);
    console.log(`Generating PR content for ${JIRA_KEY}: ${ticket.summary}`);

    const { branchName, prTitle, prBody } = await callClaude(ticket);

    const safeBranch = sanitizeBranchName(branchName);
    console.log(`Branch: ${safeBranch}`);
    console.log(`PR title: ${prTitle}`);

    setOutput("branch_name", safeBranch);
    setOutput("pr_title", prTitle);
    setOutput("pr_body", prBody);

    console.log("Outputs written to GITHUB_OUTPUT ✅");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
