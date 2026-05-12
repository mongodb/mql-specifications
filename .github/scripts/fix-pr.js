/**
 * .github/scripts/fix-pr.js
 *
 * Reads review comments on a PR and runs an agentic Claude loop
 * to apply corrections to YAML spec files.
 */

const fs = require("fs");
const { execSync } = require("child_process");
const { runAgentLoop, TOOLS } = require("./agent-tools");

const {
  GROVE_API_KEY,
  GITHUB_WORKSPACE = ".",
  PR_TITLE = "",
  PR_BRANCH = "",
  PR_NUMBER = "",
  GITHUB_REPOSITORY = "",
  GH_TOKEN = "",
} = process.env;

if (!GROVE_API_KEY) throw new Error("Missing GROVE_API_KEY secret");

const reviewComments = JSON.parse(fs.readFileSync("/tmp/review_comments.json", "utf8"));
const reviewBody = JSON.parse(fs.readFileSync("/tmp/review_body.json", "utf8")) || "";

if (reviewComments.length === 0 && !reviewBody) {
  console.log("No review comments found. Nothing to do.");
  process.exit(0);
}

// Extra tool: post a comment on the PR via gh CLI
const ADD_COMMENT_TOOL = {
  name: "add_pr_comment",
  description: "Post a comment on the pull request to explain a change that was made. Call this after each write_file.",
  input_schema: {
    type: "object",
    properties: {
      body: { type: "string", description: "Comment text in Markdown." },
    },
    required: ["body"],
  },
};

async function executeExtraTool(name, input) {
  if (name === "add_pr_comment") {
    const tmpFile = `/tmp/pr_comment_${Date.now()}.md`;
    fs.writeFileSync(tmpFile, input.body, "utf8");
    execSync(`gh issue comment ${PR_NUMBER} --repo ${GITHUB_REPOSITORY} --body-file ${tmpFile}`, {
      stdio: "inherit",
      env: { ...process.env, GH_TOKEN },
    });
    fs.unlinkSync(tmpFile);
    return { success: true };
  }
  return { error: `Unknown extra tool: ${name}` };
}

const { executeTool: baseExecuteTool } = require("./agent-tools");

async function executeTool(name, input) {
  if (name === "add_pr_comment") return executeExtraTool(name, input);
  return baseExecuteTool(name, input);
}

const SYSTEM_PROMPT = `You are an expert agent for the MongoDB MQL Specifications repository.
Your task is to apply corrections to YAML operator spec files based on review comments.

Rules:
- Read the file before modifying it
- Apply only the changes requested in the review comments
- After each write_file, call add_pr_comment to explain what was changed and why
- After all corrections, call validate_spec to verify the files are valid
- The 'link' field must ALWAYS use 'manual', never 'upcoming'
- The YAML must start with: # $schema: ../../schemas/operator.json
- End each file with a newline
- Do not modify files not mentioned in the review comments`;

(async () => {
  try {
    const commentsText = reviewComments
      .map((c) => `File: ${c.path}${c.line ? ` (line ${c.line})` : ""}\n${c.user}: ${c.body}`)
      .join("\n\n");

    const userMessage = `PR: ${PR_TITLE} (branch: ${PR_BRANCH})

${reviewBody ? `General review comment:\n${reviewBody}\n\n` : ""}${commentsText ? `Inline review comments:\n${commentsText}` : ""}

Please read the relevant files and apply the requested corrections.`;

    console.log(`Applying review corrections for: ${PR_TITLE}`);

    await runAgentLoop({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      groveApiKey: GROVE_API_KEY,
      extraTools: [ADD_COMMENT_TOOL],
      executeToolFn: executeTool,
    });

    console.log("✅ Fix agent completed");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
