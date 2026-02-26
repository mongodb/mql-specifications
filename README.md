# MongoDB MQL Specifications

This repository is the source of truth for MongoDB Query Language (MQL) operator specifications.

## Scope

- Operator and stage definitions are maintained in language-neutral YAML files under `definitions/`.
- Validation rules are maintained in `schema.json`.

## Language-specific consumers

Some downstream projects generate strongly-typed APIs, builders, tests, or docs from these specifications.
To do that, they typically need a **Type mapping / accepted-input metadata** (for example: how abstract MQL/BSON types map to a target language type system).
