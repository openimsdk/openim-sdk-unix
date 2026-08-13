# Local native runtime matrix v2

> **INTERNAL DEVELOPMENT INFRASTRUCTURE — NOT A CUSTOMER DELIVERABLE**
>
> The matrix runner is the shared team/CI verification engine for Public,
> Private, and IM+AV source trees. It is never assembled into a customer
> delivery bundle. Product delivery contains plugins, licensed native
> artifacts, examples, and integration documentation only.

This runner builds local native hosts from verified DCloud offline SDKs. It does
not call DCloud cloud packaging. Maven, Gradle, CocoaPods, and the configured IM
server may still use the network.

## Toolchain profile

Install and verify the four SDK archives once, then expose only the immutable
profile document:

```bash
export OPENIM_UNI_TOOLCHAIN_PROFILE=/path/to/dcloud-5.23-v2/profile.json
npm run uni:toolchain -- verify --profile "$OPENIM_UNI_TOOLCHAIN_PROFILE"
```

The profile contains classic uni-app and uni-app x SDK identities for Android
and iOS plus the host compiler/tool versions. Product descriptors contain only
relative product inputs and native artifact identities.

## Commands

```bash
npm run local -- doctor --product public --surface uniappx --platform android
npm run local -- build --product public --surface uniapp-vue3 --platform ios
npm run local -- run --product public --surface uniapp-vue2 --platform android
npm run local -- test --product public --surface uniappx --platform ios --suite full
npm run local -- matrix --product public --tier pr
npm run local -- list-runs
npm run local -- cleanup --run-id RUN_ID
```

`pr` assembles all six product cells. `nightly` and `rc` run Vue 2 smoke and
the full Vue 3/uni-app x suites. Full suites require `OPENIM_API_BASE`,
`OPENIM_WS_BASE`, and `IM_SECRET`; disposable users are registered directly
through the IM server. Credentials, tokens, and server addresses are never
written to matrix evidence.

Stable generated projects live below
`$OPENIM_LOCAL_WORKSPACE_ROOT/<product>/<surface>`.
Runs are serialized by a PID-owned global lock and evidence is immutable below
`.runs/<runID>`. Cleanup accepts only a specific directory containing an
evidence record; it never removes a repository or SDK profile.

Before a generated project is published atomically, the runner removes
machine-local state from every surface and plugin copy. This includes
`static/openim-test-config.json`, `.openim-test-accounts.json`, `env.js`,
`test-results/`, `.runs/`, and active `local-config.*` files. Example templates
such as `local-config.example.uts` remain available. A final fail-closed scan
then rejects recognizable secrets, values supplied through sensitive runtime
environment variables, and concrete server addresses in executable/config
sources. Findings contain only a relative path and rule name; they never echo
the matched value. Runtime credentials and endpoints must cross an in-memory
test seam instead of being compiled into the stable project.

Evidence states are `NOT_RUN`, `COMPILE_PASS`, `ASSEMBLE_PASS`, `SMOKE_PASS`,
`FULL_PASS`, and `BLOCKED`. Release evidence must come from a clean exact
revision and include the toolchain, native artifact, APK/app, device, suite,
and `cloudPackaging=false` identities.
