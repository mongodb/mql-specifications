/**
 * .github/scripts/generate-pr.js
 *
 * Reads Jira ticket data from environment variables,
 * calls the Claude API, and writes branch/PR content
 * to the GitHub Actions output file ($GITHUB_OUTPUT).
 *
 * No npm install needed — uses Node.js built-in fetch (v18+).
 */

const {
  GROVE_API_KEY,
  JIRA_KEY,
  JIRA_SUMMARY,
  JIRA_DESCRIPTION = "",
  JIRA_TYPE = "Task",
  JIRA_PRIORITY = "Medium",
  JIRA_ASSIGNEE = "Unassigned",
  GITHUB_OUTPUT,
} = process.env;

if (!GROVE_API_KEY) throw new Error("Missing GROVE_API_KEY secret");
if (!JIRA_KEY || !JIRA_SUMMARY) throw new Error("Missing JIRA_KEY or JIRA_SUMMARY input");

async function callClaude() {
  const prompt = `You are a developer assistant. Given a Jira ticket, generate:
1. A Git branch name (kebab-case, max 60 chars, starts with the ticket key)
2. A Pull Request title (concise, starts with [TICKET_KEY])
3. A Pull Request description in Markdown with sections:
   - ## Summary (1-2 sentences)
   - ## Changes (bullet list of expected changes)
   - ## Testing (basic checklist)
   - ## Jira
     Link: https://jira.mongodb.org/browse/${JIRA_KEY}

Ticket details:
- Key: ${JIRA_KEY}
- Type: ${JIRA_TYPE}
- Priority: ${JIRA_PRIORITY}
- Assignee: ${JIRA_ASSIGNEE}
- Summary: ${JIRA_SUMMARY}
- Description: ${JIRA_DESCRIPTION || "No description provided."}

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

  // Strip accidental markdown fences
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

/**
 * Writes a key=value pair to $GITHUB_OUTPUT.
 * For multi-line values, uses the heredoc syntax required by GitHub Actions.
 */
function setOutput(key, value) {
  const fs = require("fs");
  const delimiter = `EOF_${Date.now()}`;
  const entry = `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
  fs.appendFileSync(GITHUB_OUTPUT, entry);
}

(async () => {
  try {
    console.log(`Generating PR content for ${JIRA_KEY}: ${JIRA_SUMMARY}`);
    const { branchName, prTitle, prBody } = await callClaude();

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
