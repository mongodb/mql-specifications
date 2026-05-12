/**
 * .github/scripts/fix-pr.js
 *
 * Reads review comments left on a PR and asks Claude to fix the YAML spec files.
 * Runs after a "Request changes" review is submitted.
 */

const fs = require("fs");
const path = require("path");

const { GROVE_API_KEY, GITHUB_WORKSPACE = ".", PR_TITLE = "", PR_BRANCH = "", PR_NUMBER = "", GITHUB_REPOSITORY = "" } = process.env;

if (!GROVE_API_KEY) throw new Error("Missing GROVE_API_KEY secret");

const reviewComments = JSON.parse(fs.readFileSync("/tmp/review_comments.json", "utf8"));
const reviewBody = JSON.parse(fs.readFileSync("/tmp/review_body.json", "utf8")) || "";

if (reviewComments.length === 0 && !reviewBody) {
  console.log("No review comments found. Nothing to do.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
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
        path: { type: "string", description: "Relative path from repo root." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a corrected YAML spec file to the repository.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root." },
        content: { type: "string", description: "Full corrected YAML content." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "add_pr_comment",
    description: "Post a comment on the pull request to explain a change that was made.",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string", description: "Comment text in Markdown." },
      },
      required: ["body"],
    },
  },
];

async function executeTool(name, input) {
  switch (name) {
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
    case "add_pr_comment": {
      const { execSync } = require("child_process");
      const tmpFile = `/tmp/pr_comment_${Date.now()}.md`;
      fs.writeFileSync(tmpFile, input.body, "utf8");
      execSync(`gh issue comment ${PR_NUMBER} --repo ${GITHUB_REPOSITORY} --body-file ${tmpFile}`, {
        stdio: "inherit",
        env: { ...process.env },
      });
      fs.unlinkSync(tmpFile);
      return { success: true };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

async function runFixAgent() {
  const commentsText = reviewComments
    .map((c) => `File: ${c.path}${c.line ? ` (line ${c.line})` : ""}\n${c.user}: ${c.body}`)
    .join("\n\n");

  const systemPrompt = `You are an expert agent for the MongoDB MQL Specifications repository.
Your task is to apply corrections to YAML operator spec files based on review comments.

Rules:
- Read the file before modifying it
- Apply only the changes requested in the review comments
- After each write_file, call add_pr_comment to explain what was changed and why
- The 'link' field must ALWAYS use 'manual', never 'upcoming'
- The YAML must start with: # $schema: ../../schemas/operator.json
- End each file with a newline
- Do not modify files that are not mentioned in the review comments`;

  const userMessage = `PR: ${PR_TITLE} (branch: ${PR_BRANCH})

${reviewBody ? `General review comment:\n${reviewBody}\n\n` : ""}${commentsText ? `Inline review comments:\n${commentsText}` : ""}

Please read the relevant files and apply the requested corrections.`;

  const messages = [{ role: "user", content: userMessage }];

  for (let i = 0; i < 15; i++) {
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
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      console.log("Agent:\n", text);
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`→ Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 120));
        const result = await executeTool(block.name, block.input);
        console.log(`← Result:`, JSON.stringify(result).slice(0, 120));
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    }
  }
}

(async () => {
  try {
    console.log(`Applying review corrections for: ${PR_TITLE}`);
    await runFixAgent();
    console.log("✅ Fix agent completed");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
