# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## What this repository is

Language-neutral YAML definitions for MongoDB Query Language (MQL) operators, stages, accumulators, and types. Downstream projects consume these definitions to generate strongly-typed APIs, builders, tests, and documentation. The YAML files are the primary artifact; the tooling exists only to validate and format them.

## Commands

### Validate definitions against JSON Schema
```bash
cd scripts/schema-validator
pnpm install
pnpm run validate
```

### Type-check the validator script
```bash
cd scripts/schema-validator
pnpm run typecheck
```

### Lint/format
```bash
# Check YAML formatting
yamlfix --check definitions

# Fix YAML formatting
yamlfix definitions

# Check JSON schema files
npx prettier --check "schemas/*.json"

# Fix JSON schema files
npx prettier --write "schemas/*.json"
```

## Architecture

### Two schemas govern all definitions

- `schemas/operator.json` — validates everything in `definitions/` except `types/`
- `schemas/type.json` — validates everything in `definitions/types/`

Each YAML file starts with a comment pointing to its schema: `# $schema: ../../schemas/operator.json`

### Definition categories (`definitions/`)

| Directory | Contents |
|-----------|----------|
| `expression/` | Aggregation expression operators (`$add`, `$concat`, …) |
| `accumulator/` | Accumulators for `$group` and `$setWindowFields` (`$sum`, `$avg`, …) |
| `stage/` | Aggregation pipeline stages (`$match`, `$group`, …) |
| `query/` | Query filter operators (`$eq`, `$in`, …) |
| `search/` | Atlas Search operators used inside `$search` |
| `update/` | Update operators (`$set`, `$push`, …) |
| `pipeline/` | Pipeline wrapper definitions |
| `types/` | Closed set types / enums (`timeUnit`, `sortSpec`, …) |

### Operator definition structure

Every operator file requires: `name`, `link`, `minVersion`, `type` (list), `encode`, `description`.

**`encode` values:**
- `single` — operator value is its one argument (e.g. `{ $sum: 1 }`)
- `array` — arguments are positional array elements (e.g. `{ $atan2: [y, x] }`)
- `object` — arguments are named object keys (e.g. `{ $dateAdd: { startDate, unit, amount } }`)

**`type` values** control where an operator is usable:
- Usage context: `stage`, `inputStage`, `outputStage`, `updateStage`, `accumulator`, `window`, `query`, `fieldQuery`, `filter`, `expression`, `searchOperator`, `update`, `pipeline`, `updatePipeline`, `untypedPipeline`
- Return type: `resolvesToString`, `resolvesToInt`, `resolvesToBool`, etc.

### Argument type system

Three tiers for each BSON type:
- `string` — a literal value of that type
- `resolvesToString` — any expression that resolves to that type
- `stringFieldPath` — a `$`-prefixed field path holding that type

Special types: `expression` (any expression), `expressionMap`, `geoPoint`, `unprefixedFieldPath`, closed set names (e.g. `timeUnit`), and operator-category types (`stage`, `accumulator`, etc.).

### Generics

Operators that preserve element types (e.g. `$arrayElemAt`) declare generic type parameters:

```yaml
generic:
  - T
type:
  - name: resolvesToAny
    generic: T
arguments:
  - name: array
    type:
      - name: resolvesToArray
        generic: T[]
```

The `generic` field is a TypeScript representation of the type relationship.

### Closed set types (`definitions/types/`)

Minimal format — just `name`, `backingType`, and `enum` values:

```yaml
name: timeUnit
backingType: string
enum:
  - year
  - month
  ...
```

### Test cases

Tests in operator definitions reference MongoDB docs and include a `pipeline` array plus an optional `schema` object describing the input collection shape. They are used by consumers for validation, not run by this repo.

## Formatting rules

- YAML: 2-space indent, block-style sequences (configured in `.yamlfix.toml`)
- JSON schemas: 4-space indent (configured in `.prettierrc.json`)
