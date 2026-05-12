# MongoDB MQL Specifications

This repository is the source of truth for MongoDB Query Language (MQL) operator specifications.

## Scope

- Operator and stage definitions are maintained in language-neutral YAML files under `definitions/`.
- Validation rules are maintained in `schemas/*.json`.

## Automation

Adding the `mql-spec` label to a `DRIVERS-*` Jira ticket automatically generates a branch and draft PR with the YAML spec, fetched from MongoDB documentation sources. Submitting **Request changes** on a `drivers-*` PR automatically applies the review corrections and pushes them to the branch.

See [docs/automation.md](docs/automation.md) for setup and full details.

## Language-specific consumers

Some downstream projects generate strongly-typed APIs, builders, tests, or docs from these specifications.
To do that, they typically need a **Type mapping / accepted-input metadata** (for example: how abstract MQL/BSON types map to a target language type system).
