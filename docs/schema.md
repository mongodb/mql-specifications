# MongoDB Query Language Specifications - Schema Documentation

## Overview

This document provides comprehensive documentation of the schema used to define MongoDB's query language operators (aggregation pipeline stages, accumulator expressions, aggregation expressions, and query operators). The schema is defined in `schema.json` and is used to describe operators across multiple YAML configuration files.

The project uses this schema to:
- Define MongoDB operators declaratively in YAML format
- Generate code (PHP classes) for operator builders
- Document operator behavior and provide test examples
- Ensure consistency and validity across operator definitions

## Architecture

The specification system has two components:

1. **Schema Definition** (`schema.json`): JSON Schema that validates all operator definitions
2. **YAML Operator Definitions**: Individual YAML files that describe each operator using the schema

### Operator Categories

Operators are organized into categories based on their type and purpose:

- **Stages** (`/definitions/stage`): Aggregation pipeline stages (e.g., `$match`, `$group`, `$project`)
- **Accumulators** (`/definitions/accumulator`): Used in `$group` and `$setWindowFields` stages (e.g., `$sum`, `$avg`)
- **Expression Operators** (`/definitions/expression`): Used to compute values in aggregation pipelines (e.g., `$add`, `$concat`)
- **Query Operators** (`/definitions/query`): Used in query filters (e.g., `$eq`, `$gt`, `$in`)
- **Search Operators** (`/definitions/search`): Operators used in the `$search` pipeline stage

## JSON Schema Definition

The schema is defined in `schema.json` using JSON Schema Draft 6. It defines three main object types:
1. `Operator` - The root object for all operators
2. `Argument` - Defines a single parameter/argument for an operator or stage
3. `Test` - Example usage pattern for an operator or stage

### Operator

The `Operator` object is the main definition for any operator in the system.

**Required Properties:**

- `name`: The name of the operator, e.g. `$sum`
- `link`: Link to the official documentation for the operator
- `type`: Categories/contexts where the operator can be used
- `encode`: How the operator parameters are encoded when serialized
- `description`: Human-readable description of what the operator does

**Optional Properties:**

- `wrapObject`: Whether to wrap the operator's output in an object; defaults to `true`
- `arguments`: Defines the parameters/arguments for the operator
- `tests`: Example usage patterns for the operator

#### Types
The `type` property is a list of strings that defines the operator's type which may limit its usage, as well as the return type. The following types are available:
- `accumulator`: Used as an accumulator in `$group`
- `stage`: Aggregation pipeline stage (outputs at pipeline level)
- `query`: Top-level query operator or field query operator
- `fieldQuery`: Field-level query operator (inside a field selector)
- `filter`: Filter expression
- `window`: User in `$setWindowFields`
- `geometry`: Geometric query type
- `searchOperator`: MongoDB Atlas Search operator
- `switchBranch`: Branch in a `$switch` expression

In addition to the above types, you can specify any of the `resolvesTo*` types explained below to indicate the return type of the operator.

---

### Argument

Defines a single parameter/argument for an operator.

**Required Properties:**
- `name`: The name of the parameter as it appears in the operator
- `type`: Defines what types of values this parameter accepts

**Optional Properties:**
- `description`: Human-readable description of the parameter's purpose
- `optional`: Whether this parameter can be omitted; defaults to `false`
- `valueMin`: Minimum numeric value for this parameter, used for validation and code generation
- `valueMax`: Maximum numeric value for this parameter, used for validation and code generation
- `variadic`: Specifies if this argument can accept multiple values (see example below)
- `variadicMin`: Minimum number of values for variadic arguments
- `default`: Default value for optional parameters when no value was specified
- `mergeObject`: Whether to merge the argument into the parent object when using `object` encoding; defaults to `false`

#### Types

For arguments types, you can specify any of the types explained below:

##### BSON Types

For all of the BSON types, the schema knows three different uses for a type:
- `<type>`: this denotes a value of a given type
- `resolvesTo<type>`: this denotes an expression that resolves to a value of a given type
- `<type>FieldPath`: a field path containing a value of a given type

| Type | Expression Type | Field Path Type | Description |
| --- | --- | --- | --- |
| `any` | `resolvesToAny` | `fieldPath` | This is the "top type", which matches any value |
| `double` | `resolvesToDouble` | `doubleFieldPath` | 64-bit floating-point number |
| `int` | `resolvesToInt` | `intFieldPath` | A 32-bit integer |
| `long` | `resolvesToLong` | `longFieldPath` | A 64-bit integer |
| `decimal` | `resolvesToDecimal` | `decimalFieldPath` | A 128-bit decimal number |
| `number` | `resolvesToNumber` | `numberFieldPath` | Any numeric type (`int`, `long`, `decimal`) |
| `string` | `resolvesToString` | `stringFieldPath` | UTF-8 string |
| `object` | `resolvesToObject` | `objectFieldPath` | Embedded document |
| `array` | `resolvesToArray` | `arrayFieldPath` | Array of values |
| `binData` | `resolvesToBinData` | `binDataFieldPath` | Binary data |
| `objectId` | `resolvesToObjectId` | `objectIdFieldPath` | A BSON ObjectId |
| `bool` | `resolvesToBool` | `boolFieldPath` | Boolean `true` or `false` |
| `date` | `resolvesToDate` | `dateFieldPath` | UTC datetime |
| `regex` | `resolvesToRegex` | `regexFieldPath` | A BSON regular expression |
| `javascript` | `resolvesToJavascript` | `javascriptFieldPath` | BSON JavaScript object |
| `timestamp` | `resolvesToTimestamp` | `timestampFieldPath` | BSON Timestamp |
| `null` | `resolvesToNull` | `nullFieldPath` | Null value |

##### Operator Types

For aggregation pipeline stages or query operators, the following types can be used to limit type accepted values: 

- `accumulator`: Used as an accumulator in `$group`
- `query`: Top-level query operator or field query operator
- `fieldQuery`: Field-level query operator (inside a field selector)
- `pipeline`: An aggregation pipeline
- `window`: User in `$setWindowFields`
- `searchOperator`: MongoDB Atlas Search operator

##### Special Types

- `expression`: Any aggregation expression
- `geoPoint`: GeoJSON point specification

##### Closed Sets

These closed sets are used in some operators. If the programming language supports enums, it is encouraged to use an enum for these types.

- `timeUnit`: Time unit string for date operations
- `sortSpec`: Sort specification (1 for ascending, -1 for descending)
- `granularity`: Date granularity specification
- `fullDocument`: Change stream options
- `fullDocumentBeforeChange`: Change stream options
- `accumulatorPercentile`: Special accumulator for percentile operations
- `range`: Range specification
- `sortBy`: Sort specification object
- `whenMatched`: Merge strategy for matched documents
- `whenNotMatched`: Merge strategy for unmatched documents
- `outCollection`: Output collection specification
- `searchPath`, `searchScore`: Search-specific types

#### Variadic arguments
For variadic arguments, you can declare a variadic argument as a list of values (`array`), or as an object with multiple properties (`object`).

**Example:**
```yaml
name: values
type:
  - expression
variadic: array
variadicMin: 1
description: Multiple expressions to process
```

#### `mergeObject` example
If `mergeObject` is `true`, the variadic argument is hoisted into the parent object. This is used for the `$group` stage where accumulators merge into the group specification.

**Example:**
```yaml
name: field
mergeObject: true
type:
  - accumulator
variadic: object
description: Computed fields using accumulators
```

---

### Test

Defines an example/test case for an operator. Tests are taken from the operator's documentation examples and can be used to validate the consuming application's behavior.

**Required Properties:**

- `name`: Title of the test/example
- `link`: Link to the specific example in MongoDB's documentation
- `pipeline`: Aggregation pipeline demonstrating the operator

---

## Special Features and Patterns

### 1. Encoding Types

Different operators use different encoding strategies to determine how arguments are serialized into the final operator representation.

#### `single`

Used when the operator has one main parameter that becomes the entire operator value. The argument name is not used in the output.

**Definition:**
```yaml
name: $sum
encode: single
arguments:
  - name: expression
    type: [resolvesToNumber]
```

**Output example:**
```javascript
{ $sum: 1 }
```

**Variadic Single Encoding:**

When single encoding is combined with `variadic: array`, multiple values are passed as an array:

```yaml
name: $and
encode: single
arguments:
  - name: queries
    type: [query]
    variadic: array
    variadicMin: 1
```

**Output example:**
```javascript
{
  $and: [
    { status: 'active' },
    { price: { $gt: 100 } }
  ]
}
```

#### `array`

Used when arguments are positional and should be encoded as an array in the order they are defined. Each argument becomes an array element.

**Definition:**
```yaml
name: $atan2
encode: array
arguments:
  - name: y
    type: [resolvesToNumber]
  - name: x
    type: [resolvesToNumber]
```

**Output example:**
```javascript
{ $atan2: [1, 2] }
```

#### `object`

Used when arguments are named properties and should be encoded as an object with keys matching the parameter names. This is the most common encoding for complex operators.

**Definition:**
```yaml
name: $dateAdd
encode: object
arguments:
  - name: startDate
    type: [resolvesToDate]
  - name: unit
    type: [timeUnit]
  - name: amount
    type: [resolvesToNumber]
```

**Output example:**
```javascript
{
  $dateAdd: {
    startDate: '$date',
    unit: 'day',
    amount: 7
  }
}
```

**Output with `mergeObject`:**

When an argument has `mergeObject: true`, its properties are merged into the parent object instead of being nested. This is used for flexible multi-field arguments.

```yaml
name: $group
encode: object
arguments:
  - name: _id
    type: [expression]
  - name: field
    type: [accumulator]
    mergeObject: true
    variadic: object
    variadicMin: 0
```

**Usage:**

Consider the following builder call using named arguments:
```javascript
Group(
    _id: '$category',
    totalSales: Sum('$amount'),
    count: Count(),
    avgPrice: Avg('$price')
)
```

Without `mergeObject: true`, this would generate the following expression:
```javascript
{
  $group: {
    _id: '$category',
    field: {
      totalSales: { $sum: '$amount' },
      count: { $count: {} },
      avgPrice: { $avg: '$price' }
    }
  }
}
```

With `mergeObject: true`, the properties are merged into the parent object:
```javascript
{
  $group: {
    _id: '$category',
    totalSales: { $sum: '$amount' },
    count: { $count: {} },
    avgPrice: { $avg: '$price' }
  }
}
```

#### Comparison Table

| Encoding | Use Case | Property Names | Multiple Values | Example |
|----------|----------|---|---|---|
| `single` | Operator takes one parameter | ❌ Not used | Optional (as array) | `{ $sum: 1 }` |
| `array` | Positional arguments in order | ❌ Not used | As array elements | `{ $atan2: [1, 2] }` |
| `object` | Named properties | ✅ Required | Object properties | `{ $dateAdd: { startDate, unit, amount } }` |

### 2. Variadic Arguments

Arguments can accept multiple values:

**Array Variadic:**
```yaml
name: values
type: [expression]
variadic: array
variadicMin: 1
```
Accepts: `[value1, value2, value3, ...]`

**Object Variadic:**
```yaml
name: field
type: [accumulator]
variadic: object
mergeObject: true
```
Accepts: Multiple object properties that merge into parent

### 3. Merge Object Pattern

Used for `$group` stage where accumulators merge into the group specification:

```yaml
name: field
mergeObject: true
type:
  - accumulator
variadic: object
```

This allows:
```yaml
$group:
  _id: value
  sum: { $sum: '$amount' }
  avg: { $avg: '$amount' }
```

Without `mergeObject`, it would require a wrapper field.

### 4. Wrap Object Control

The `wrapObject` property controls whether object properties are wrapped:

```yaml
wrapObject: false  # Don't wrap in operator name
encode: object
```

Used for operators like `$case` that are meant to be embedded without an outer wrapper.

### 5. Return Type Declaration

Operators can declare multiple return type possibilities:

```yaml
type:
  - resolvesToInt
  - resolvesToLong
  - resolvesToDouble
  - resolvesToDecimal
  - resolvesToDate
```

This indicates the operator's return type depends on its inputs.

---
