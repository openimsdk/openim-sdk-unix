# Local native runtime matrix v2

This runner builds local native hosts from verified DCloud offline SDKs. It does
not call DCloud cloud packaging. Maven, Gradle, CocoaPods, and the configured IM
server may still use the network.

## Toolchain profile

Install and verify the four SDK archives once, then expose only the immutable
profile document:

```bash
export OPENIM_UNI_TOOLCHAIN_PROFILE=/Volumes/workspace/work/uni-toolchains/profiles/dcloud-5.23-v2/profile.json
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
`/Volumes/workspace/work/openim-uni-runtime-workspaces/<product>/<surface>`.
Runs are serialized by a PID-owned global lock and evidence is immutable below
`.runs/<runID>`. Cleanup accepts only a specific directory containing an
evidence record; it never removes a repository or SDK profile.

Evidence states are `NOT_RUN`, `COMPILE_PASS`, `ASSEMBLE_PASS`, `SMOKE_PASS`,
`FULL_PASS`, and `BLOCKED`. Release evidence must come from a clean exact
revision and include the toolchain, native artifact, APK/app, device, suite,
and `cloudPackaging=false` identities.
