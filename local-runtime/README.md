# Public unix-openim-sdk local runtime harness

This source-only harness builds, installs, launches, and tests the Public
`unix-openim-sdk` uni-app x project without invoking DCloud cloud packaging.

It deliberately does not track DCloud SDK files, Gradle wrapper binaries,
OpenIM AAR/XCFramework binaries, generated UTS output, APKs, apps, credentials,
test accounts, tokens, signing material, build caches, or machine-local paths.
The ignored inputs are copied from explicit local sources and verified against
`toolchain.lock.json` before use.

The pipeline uses the platform behavior documented by DCloud:

- Android third-party AARs are compiled into a local uni-app x native SDK host.
- iOS Swift/UTS code and the locked XCFramework are compiled locally by
  HBuilderX and Xcode. The minimum supported iOS version is 14.
- `uni-websocket` is embedded because uni-automator uses it as its control
  channel.

## Inputs

- HBuilderX `5.23.2026080313-alpha`, matching `toolchain.lock.json`.
- The Public Core checkout/artifacts matching `toolchain.lock.json`. Set
  `OPENIM_PUBLIC_CORE_DIR` when it is not a sibling checkout.
- Android uni-app x SDK `Android-uni-app-x-SDK@14987-5.23` and its original zip.
  Set `OPENIM_DCLOUD_ANDROID_SDK_ROOT` and
  `OPENIM_DCLOUD_ANDROID_SDK_ZIP` when they are not in the standard local cache.
- Android SDK and Gradle 8.14.x for Android.
- Xcode and an available iPhone Simulator for iOS. Physical iPhone runs also
  require local signing inputs.
- The official HBuilderX `hbuilderx-for-uniapp-test` plugin. `local:test:*`
  verifies/installs the locked plugin and prepares its Jest runtime with an
  isolated temporary npm cache; no Playwright browser download is required.

## Commands

```bash
npm run local:build:android
npm run local:run:android
npm run local:test:android

npm run local:build:ios
npm run local:run:ios
npm run local:test:ios
```

Each `local:test:*` command performs the complete local path for its platform:

1. verify the locked OpenIM Core and HBuilderX inputs;
2. compile the uni-app x resources and UTS plugin locally;
3. assemble and sign a local APK or Simulator app;
4. uninstall the previous harness and install the newly assembled one;
5. provision disposable users directly through OpenIM Server;
6. run the uni-automator API, event, upload, lifecycle, and cleanup suites; and
7. write redacted evidence under `test-results/openim-automation/`.

No DCloud cloud packaging or Chat token service is used.

## Isolated Public OpenIM Server

When a commercial OpenIM deployment already exists on the target machine, run
the Public server from a separate source checkout and a separate runtime root.
The harness does not create a Git worktree. It verifies the exact revision of
`OPENIM_PUBLIC_SERVER_SOURCE`, creates only
`OPENIM_PUBLIC_SERVER_SOURCE/.openim-public-test`, and gives the Public
deployment its own Docker project, discovery root, data, configuration, logs,
PID files, and ports.

```bash
export OPENIM_PUBLIC_SERVER_SSH='<ssh-user>@<server-host>'
export OPENIM_PUBLIC_SERVER_SOURCE='<absolute-path-to-public-open-im-server>'
export OPENIM_PUBLIC_SERVER_REVISION='<full-public-server-commit>'
export OPENIM_PUBLIC_SERVER_PUBLIC_HOST='<server-lan-host>'
export OPENIM_PUBLIC_SERVER_KNOWN_HOSTS_FILE='<dedicated-known-hosts-file>'

bash local-runtime/scripts/provision-isolated-openim-server.sh
```

The default isolated endpoints are API `11002` and WebSocket `11001`. They are
intentionally different from the standard `10002`/`10001` pair. Dependency
ports and the Docker project are also isolated, and the scoped stop script
validates every recorded process command before terminating it. It never uses
`mage stop`, `killall`, or `pkill`.

To stop only the isolated Public deployment on the server:

```bash
OPENIM_PUBLIC_SERVER_SOURCE='<absolute-path-to-public-open-im-server>' \
  bash '<absolute-path-to-public-open-im-server>/.openim-public-test/stop-isolated-openim-server.sh'
```

After provisioning, obtain the server secret through a private shell variable
or secret manager. Do not print it, pass it on a command line visible to other
users, or persist it in this checkout.

`local:test:*` provisions fresh users directly through OpenIM Server and does
not call Chat. Supply service and admin credentials through environment
variables; never write them into this directory:

```bash
OPENIM_API_BASE=http://<PUBLIC-IM-SERVER-LAN-IP>:11002 \
OPENIM_WS_BASE=ws://<PUBLIC-IM-SERVER-LAN-IP>:11001 \
IM_SECRET='<server-secret>' \
npm run local:test:android
```

Run `local:test:ios` with the same endpoints and an explicit simulator UDID:

```bash
OPENIM_API_BASE=http://<PUBLIC-IM-SERVER-LAN-IP>:11002 \
OPENIM_WS_BASE=ws://<PUBLIC-IM-SERVER-LAN-IP>:11001 \
IM_SECRET='<server-secret>' \
OPENIM_IOS_SIMULATOR_UDID='<simulator-udid>' \
npm run local:test:ios
```

The runtime report distinguishes functional execution from release evidence.
An API call may pass functionally while the stricter evidence gate remains red
until semantic read-back, side effects, correlated events, negative behavior,
and cleanup have all been demonstrated. Do not weaken that gate merely to turn
the aggregate Jest suite green.

Generated hosts and evidence live under `unpackage/` and `test-results/` and
remain ignored. `env.js` is generated locally so uni-automator uses the exact
APK/app produced by this checkout.
