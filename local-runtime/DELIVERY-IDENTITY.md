# Delivery identity in local runtime evidence

> **INTERNAL DEVELOPMENT INFRASTRUCTURE — NOT A CUSTOMER DELIVERABLE**

The local runner can test either a source checkout or an already assembled
delivery candidate. A product descriptor opts into candidate binding with one
generic declaration:

```json
{
  "delivery": {
    "manifest": "${OPENIM_LOCAL_DELIVERY_ROOT}/delivery-manifest.json",
    "checksums": "${OPENIM_LOCAL_DELIVERY_ROOT}/SHA256SUMS",
    "pluginRoot": "${OPENIM_LOCAL_DELIVERY_ROOT}/uni_modules",
    "baselineJsonPointer": "/source/revision"
  }
}
```

The four paths are resolved by the same descriptor-relative and explicit
environment-variable rules as plugin sources. `baselineJsonPointer` is an RFC
6901 JSON Pointer and must resolve to a non-empty string in the manifest.

Before staging, the runner:

1. verifies every regular file listed in `SHA256SUMS`;
2. requires the manifest and every file below `pluginRoot` to be checksummed;
3. rejects absolute, escaping, duplicate, malformed, and symlinked checksum
   paths; and
4. requires every plugin source in the descriptor to live below the declared
   `pluginRoot`.

Successful evidence adds:

```json
{
  "delivery": {
    "manifestSha256": "<sha256>",
    "checksumsSha256": "<sha256>",
    "baseline": "<manifest value>",
    "pluginTreeSha256": "<deterministic tree sha256>"
  }
}
```

`source` continues to identify the tested product repository revision and
dirty state. `runner` continues to identify the shared runner revision and
dirty state. These identities are deliberately separate: a matching source
commit cannot stand in for the exact bytes of an assembled delivery candidate.
