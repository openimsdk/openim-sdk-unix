# Public 插件市场发布流程

本流程只适用于 DCloud 插件市场中的 Public `unix-openim-sdk`。Private/HarmonyOS 版本和 `openim-av-runtime` 不得使用该产物。

## 分支和版本

- 发布源码以 `origin/main` 为唯一基线。
- 发布准备使用临时分支 `release/public-<version>`。
- 分支只允许版本、市场文档、确定性打包和发布门禁改动，不接收新功能。
- 发布 PR 使用 merge commit 合回 `main`，禁止 squash、rebase 和 force-push。
- Tag 固定为 `unix-openim-sdk-public-v<version>`，必须指向 release PR 的 `main` merge commit。
- DCloud 上传完成并核对后删除临时 release 分支；Tag 和发布产物永久保留。

## 市场包边界

市场上传内容由 `uni_modules/unix-openim-sdk/package.json` 的 `files` allowlist控制：

- `package.json`
- `LICENSE`
- `README.md`
- `CHANGELOG.md`
- `MARKET_USAGE.md`
- `utssdk` 中的 Public Android/iOS/common/interface/unierror 源码

以下内容必须始终排除：

- `utssdk/app-harmony`
- AAR、HAR、JAR、XCFramework、Framework、SO 和本地 `libs`/`Frameworks`
- Enterprise 合同、商业信令、Session Snapshot、AV Runtime
- 测试账号、Token、服务器地址、日志、截图和自动化证据
- `node_modules`、`unpackage`、`.hbuilderx`、本机绝对路径

Android 和 iOS 原生 SDK 由市场插件配置引用远端制品，不随源码包内嵌：

- Android `io.openim:core-sdk:3.8.3-patch15`
- iOS `OpenIMSDKCore 3.8.3-hotfix.15-dynamic.1`

## 发布候选生成

必须从 clean checkout 执行：

```bash
npm ci
npm run generate
git diff --exit-code
npm run typecheck:tooling
npm run test:tooling
npm run verify
npm run verify:generated
npm run verify:policy
npm run verify:release-integrity -- --release
npm run verify:release-policy
npm run compile:public
npm run marketplace:build
```

产物位于 `dist/public-marketplace/`：

- `unix-openim-sdk-<version>-marketplace.zip`
- `unix-openim-sdk-<version>-marketplace-manifest.json`
- `SHA256SUMS`

ZIP 用于审计、GitHub Release 和归档。实际向 DCloud 更新 uni_modules 插件时，必须在同一 Tag 的 clean checkout 中用 HBuilderX 右键 `uni_modules/unix-openim-sdk` 执行“发布/更新到插件市场”；上传前后核对 HBuilderX 展示的版本、平台和文件差异与 manifest 一致。

## 正式发布门禁

以下条件全部满足前不得打 Tag、上传市场或标记 Release Approved：

- Public 合同、生成、policy、SBOM、license、secret scan 全绿。
- Maven AAR 与锁定 Public Core AAR SHA-256 一致。
- CocoaPods XCFramework 与锁定 Public Core inventory SHA-256 一致。
- Android/iOS release dependency profile 编译和 consumer compile/link 通过。
- Android arm64 物理设备连续三次 clean Release 自动化通过。
- iOS 物理设备连续三次 clean Release 自动化通过。
- 两平台证据均绑定最终 merge commit，`dirty=false`，无 skip 或已知问题豁免。
- 候选 ZIP 在两个独立 clean checkout 中 SHA-256 一致。

## 发布和回滚

1. release PR 合入 `main`。
2. 在 merge commit 上创建签名 Tag。
3. 从 Tag 的两个 clean checkout 各生成一次候选并比较 SHA-256。
4. 创建 GitHub Release，附 ZIP、manifest、`SHA256SUMS` 和 SBOM。
5. 在同一 Tag checkout 中通过 HBuilderX 更新 DCloud 插件 ID `unix-openim-sdk`。
6. 从插件市场重新导入到空白 uni-app x 工程，制作本地自定义基座并完成安装/初始化/登录/消息收发冒烟。
7. 删除临时 release 分支。

回滚时发布更高 patch 版本恢复上一稳定实现，不移动或覆盖已经发布的 Tag 和市场版本。
