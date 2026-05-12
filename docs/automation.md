# MQL Spec Automation

## Overview

Two GitHub Actions workflows automate the creation and correction of MQL specification PRs from Jira tickets, using Claude (via MongoDB's internal Grove Gateway API) as an agentic backend.

## Workflow: Create PR from Jira ticket

**File:** `.github/workflows/create-pr.yml`

### Triggers

- **Jira Automation** — two rules on the `DRIVERS` project:
  1. Issue created with label `mql-spec`
  2. Label `mql-spec` added to an existing ticket
- **Manual** — via the GitHub Actions UI or CLI:
  ```bash
  gh workflow run create-pr.yml --field key=DRIVERS-1234
  ```

### Behavior

1. Checks if a PR already exists for the ticket (branch matching `drivers-XXXX-*`)
2. **Create mode** (no existing PR):
   - Fetches the full ticket from Jira
   - Searches for the operator documentation (RST source) in `10gen/docs-mongodb-internal`, then `mongodb/docs` as fallback — on main branch first, then open PRs
   - Reads existing similar specs for format reference
   - Generates the YAML spec file, validates it with `yamlfix` and the JSON schema validator
   - Creates a branch, commits the file, and opens a draft PR assigned to the workflow trigger actor
3. **Update mode** (PR already exists):
   - Checks out the existing PR branch
   - Compares the current spec with the latest documentation
   - Pushes an update only if there are meaningful differences

### Agent tools

| Tool | Description |
|---|---|
| `search_docs` | Finds the operator `.txt` file across docs repos, on main branch and open PRs |
| `fetch_docs_file` | Fetches raw RST content via GitHub API |
| `list_files` / `read_file` / `write_file` | Reads and writes spec files in the repo |
| `validate_spec` | Runs `yamlfix` + JSON schema validator after writing |

---

## Workflow: Fix PR from review

**File:** `.github/workflows/fix-pr.yml`

### Triggers

- **Automatic** — when a repository member or collaborator submits **Request changes** on a `drivers-*` branch PR
- **Manual** — via the GitHub Actions UI or CLI:
  ```bash
  gh workflow run fix-pr.yml --field pr_number=42
  ```

### Behavior

1. Collects all inline and general review comments from the PR
2. Reads the relevant YAML spec files
3. Applies the requested corrections
4. Posts a PR comment for each change made
5. Validates the result with `yamlfix` and the JSON schema validator
6. Commits and pushes to the same branch, attributed to the workflow trigger actor

---

## Shared agent code

**File:** `.github/scripts/agent-tools.js`

Shared tool definitions and agentic loop used by both workflows. Accepts an injectable `executeToolFn` to allow per-workflow tool extensions (e.g. `add_pr_comment` in the fix workflow).

---

## Setup

### Secrets

| Secret | Description |
|---|---|
| `GROVE_API_KEY` | MongoDB internal Claude API (Grove Gateway) |
| `JIRA_PAT` | Personal access token for `jira.mongodb.org` (generate at https://jira.mongodb.org/tokens) |
| `DOCS_GITHUB_TOKEN` | PAT with read access to `10gen/docs-mongodb-internal` |

### Jira Automation

Create two rules in Jira Automation (Settings → Automation) targeting project `DRIVERS`:

**Rule 1 — Issue created**
- Trigger: Issue created
- Condition: Label = `mql-spec`
- Action: Send web request

**Rule 2 — Label added**
- Trigger: Label added = `mql-spec`
- Action: Send web request

Both rules use the same web request configuration:

| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/mongodb/mql-specifications/actions/workflows/create-pr.yml/dispatches` |
| Method | POST |
| Headers | `Authorization: Bearer <GITHUB_PAT>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` |
| Body | `{"ref": "main", "inputs": {"key": "{{issue.key}}"}}` |

The GitHub PAT used by Jira needs **Actions: Read and write** permission on this repository (Settings → Developer Settings → Fine-grained tokens).
