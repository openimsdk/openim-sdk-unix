# OpenIM UTS SDK Public 重构 HANDOFF

更新时间：2026-08-06（Asia/Shanghai）

## 1. 交接结论

本分支是 Public Edition 的可恢复重构检查点，不是最终发布候选。当前已经建立可验证的 Public Contract IR、精确工具链锁、确定性生成、UTS 稳定语法 policy、Android/iOS callback/lifecycle runtime，以及直接使用 OpenIM Server 的受控自动化入口。Public Android/iOS UTS 模块在锁定工具链下均已编译通过。

按 codebase-design 的 seam/locality 判断，当前已经形成两个有价值的 deep modules：

- `contracts/base` + `tooling`：以小而稳定的合同/命令接口隐藏 surface 提取、稳定 ID、生成、ABI、policy 和日志判定细节。
- `OpenIMDriverRuntime`：以 register/resolve/reject/progress/session lifecycle 隐藏线程归一化、pending registry、epoch、exactly-once 和迟到 callback 丢弃。

但目标架构尚未完成。Android/iOS 的巨大 native façade 和 operation-specific UTS wrapper 仍然存在，codec 仍未全部收敛到单一权威语义源，`uni_modules/unix-openim-sdk` 也仍是已跟踪的过渡产物。不要把本提交描述成 P5 原子切换完成。

## 2. Git 与 edition 边界

- 工作分支：`codex/public-contract-driver-refactor`
- 起点：`main@4d36b19cb25773034a1d1f886ebec740dda0d215`
- Public remote：`origin`（`openimsdk/openim-sdk-unix`）
- Private remote 存在于本地 Git 配置中，但本分支不得推送 private artifact，也不得引入 Harmony/HAR/enterprise Core 信息。
- Public 是 `contracts/base` 的唯一权威来源。Private 应在合入 Public 后，仅维护 add-only delta 和 edition adapter。
- 本分支未执行 push。

## 3. 不可改变的外部合同

Public surface 已冻结并由 `contracts/base/surface.snapshot.json` 校验：

| 类别 | 数量 |
| --- | ---: |
| constants | 109 |
| types | 161 |
| callables | 160 |
| events | 48 |

- Contract hash：`9ad8003df587a1b9318918a043944c4264c0d8ffc08ecb15b38254281cf61bc3`
- 导出名、常量值、参数顺序、可选性、nullability、同步/Promise/void 形式、response/rejection 结构、事件名和 payload 格式必须保持不变。
- raw string response/event 必须保持 Core 返回的原始字符串；禁止 parse 后重新 stringify。
- `unInitSDK(): void` 等既有 façade 形式不能因内部 teardown barrier 改变。
- Web 不在本轮范围。Public 支持矩阵是 Android API 21 和 iOS 12。

合同当前记录的 `generatedFrom.revision` 是上述起点 commit。这表示它冻结的是重构前的真实外部 surface，而不是根据新实现重新发明的 API。

## 4. 精确工具链与 native ABI

权威锁文件是 `toolchain.lock.json`：

- HBuilderX：`5.23.2026080313-alpha`
- CLI SHA256：`2e0621390eb18bbaa40878dc06a363968326352357ed30af4728b01ffcc61302`
- 内置 UTS plugin：`5.23.2026072314.2329`
- Public Core revision：`3422edca94f0178d8151397620e65b26e1665bc1`，branch `v3.8.3-patch`
- Android AAR SHA256：`a0b9ab0beb9d7c4b851c678f19ea072c7ca6b629aaa14a5e1dc93fc641d3e2e0`
- iOS XCFramework zip SHA256：`f3307833843fd7182bc6485e8ef3391efb9f915ac4f297e79471f48c9db3a75f`
- iOS extracted inventory SHA256：`842500ed71345c5d009b5ce865eadb1fd209d09b24318005623e5f5883813f19`

本地 native source 默认读取 `/Volumes/workspace/work/openim-sdk-core`，可用 `OPENIM_PUBLIC_CORE_DIR` 覆盖。`npm run verify` 会同时校验 source artifact 和插件内 local override 的 hash。

插件元数据已上调到锁定工具链：HBuilderX `>=5.23.2026080313-alpha`、uni-app-x `^5.23`。这只是最低版本表达；发布认证仍只承认上面的精确构建。

外部 Maven/Pod 坐标目前仍标记为 `release-blocked-until-proven-identical`。不能仅因为本地 AAR/XCFramework 通过就假设远端同版本 artifact 二进制等价。

## 5. 当前代码布局与权威关系

### 5.1 已建立的源码区

- `contracts/base/contract.json`：Public constants/types/callables/events、固定 ID、签名、codec/binding metadata。
- `contracts/base/surface.snapshot.json`：外部 surface 和 contract hash。
- `contracts/base/native-abi/`：锁定 AAR/XCFramework 的 ABI inventory。
- `sdk-src/uts/`：Android/iOS index template 和 event prelude。
- `sdk-src/native/android/OpenIMDriverRuntime.kt`：Android callback/lifecycle runtime。
- `sdk-src/native/ios/OpenIMDriverRuntime.swift`：iOS callback/lifecycle runtime。
- `tooling/`：合同导入、生成、policy、ABI 校验、Driver invariant、compile runner 和测试。

### 5.2 生成输出

`npm run generate` 当前确定性生成 8 个输出：

- `interface.uts`
- Android/iOS `index.uts`
- Android/iOS `events.uts`
- Android/iOS `OpenIMDriverRuntime`
- Public surface snapshot

`npm run verify` 会在内存中重建输出并逐字比较，防止手工修改生成文件。

### 5.3 仍处于过渡状态的部分

- `uni_modules/unix-openim-sdk` 仍被 Git 跟踪，本提交也包含当前生成结果，尚未完成“release staging 生成、仓库不提交产物”的最终组织目标。
- `NativeOpenIMSDK.kt/.swift` 仍是大 façade；当前只把 callback/lifecycle 状态移入 runtime，没有实现完整的统一 `callAsync/callSync/bindEvents/cancel/shutdown` Driver seam。
- operation declaration 目前从导入的 contract 中生成，但许多 request writer、response parser 和 native invocation 仍来自既有 platform declaration，而不是独立、单一的 canonical codec IR。
- 所以 deletion test 尚不通过：删除旧巨大 façade 后，系统还不能只靠新模块工作。

## 6. 已完成的改造

### 6.1 P0：可信基线

- 从真实 Public façade 导入并冻结 109/161/160/48 surface。
- 锁定并校验 Public AAR、XCFramework 和 native ABI inventory。
- 修复 Android/iOS listener protocol 与当前 Core ABI 的漂移；只存在于 native、尚未进入 Public 合同的 callback 被 edition-scoped ignore。
- compile runner 不再相信 shell exit code 0：要求平台明确成功文本，同时拒绝 `编译失败`、`error:`、`BUILD FAILED` 等标记。
- 已建立批准行为差异表：listener ABI、main-thread callback、lifecycle teardown、JSON codec 修复，以及 enterprise-only 的 Harmony 分类。

### 6.2 P1：工具链与兼容实验室骨架

- 添加 root Node/TypeScript 工程和 lockfile。
- 添加 generate/verify/native import/enterprise verify/compile 命令。
- 添加 compatibility ledger 和静态 UTS policy。
- compile runner 具备实时输出、15 秒心跳、硬超时、process-group 清理和证据文件输出，解决过去“测试看起来卡住”且残留进程的问题。
- 自动化 runner 具备启动/总超时、心跳、storage 清理和测试 artifact 输出。

### 6.3 P2：Contract IR 与生成器第一版

- Base IR、稳定 ID、surface hash、schema/数量/signature 校验已落地。
- interface/constants/operations/events/Driver runtime 可重复生成。
- 具体 event handler 数组、snapshot dispatch、幂等 unsubscribe、`offAll` switch 和 `@UTSJS.keepAlive` 由生成器输出。
- 生成 determinism 已进入 `npm run verify`。

还没有完成的 P2 项：完整 consumer compile probe、每个 operation 的独立 codec metadata/codegen、全部 native binding stub、package inventory 和 public/private base artifact hash 流程。

### 6.4 P3：Android/iOS Driver lifecycle slice

两端 runtime 已实现：

- 单一 serial executor/DispatchQueue。
- 内部 task ID、session epoch、pending registry。
- success/error exactly-once；重复 terminal callback 和 terminal 后 progress 被丢弃。
- callback/event 统一投递 main thread。
- `unInit` 先失效 epoch、拒绝在途 callback，再 retirement 本地 listener 引用并调用 Core。
- listener 每个 epoch 至多绑定一次。
- 避免调用 nullable listener setter 传 null/nil：当前 Go Core 会把它传给 reflection 并 panic，已登记为 `UTS-COMPAT-NATIVE-LISTENER-001`。

### 6.5 自动化流程简化

- 账号 fixture 不再依赖 Chat，直接调用 OpenIM admin token、`user_register`、`get_user_token`、`parse_token`。
- 默认生成 iOS/Android token；Private 可再请求 Harmony platform 11 token。
- `.openim-test-accounts.json`、`static/openim-test-config.json`、`test-results/` 已忽略。
- `uni-websocket` 只为 uni-automator 连接测试宿主而加入 Android/iOS manifest；纯页面 autorun 本身不是因为 SDK runtime 新限制才需要它。
- 支持页面 autorun + 原生日志/结果文件，不强依赖 Jest RPC。

## 7. 当前验证结果

2026-08-06 在当前分支执行：

```text
npm run typecheck:tooling   PASS
npm run test:tooling        PASS (6/6)
npm run verify              PASS
npm run compile:public      PASS (Android + iOS)
```

模块编译证据位于被忽略的 `test-results/compile/`：

- Android：30.132s，exit 0，明确成功，0 failure marker；log SHA256 `4d77d2feb4f8c9fec61542585fe83646c8dd7ceeccc22b21c084108776f4d0b9`。
- iOS：25.493s，exit 0，明确成功，0 failure marker；log SHA256 `d8ad5d4a2f7c8446689f0c651389b509775a6c42e05e30a18959e74d34e26caa`。

这里的 PASS 只代表 HBuilderX UTS module compile。尚未用本 Public checkpoint 完成 Android/iOS full minimal-consumer compile/link、安装和 live Core runtime 认证，因此不能据此发布。

## 8. UTS compatibility ledger

当前已登记并参与治理的规则包括：

- `UTS-COMPAT-EDITION-001`：native-only callback 的 edition scope。
- `UTS-COMPAT-CODEC-001`：`any`/`UTSJSONObject` 只存在于 codec boundary。
- `UTS-COMPAT-SWITCH-001`：iOS braced switch case 编译器 workaround。
- `UTS-COMPAT-JSON-001`：Android typed JSON helper 必须 file-local import `UTSAndroid`。
- `UTS-COMPAT-NATIVE-LISTENER-001`：Core nullable listener setter 实际不能安全接收 null/nil。
- Harmony 条目保留在共享 ledger 供 Private 使用，但 Public artifact 不应包含 Harmony 代码或 HAR。

新语法不能因文档声称支持就进入 shared-stable。必须有最小 `.uvue` consumer、适用平台 debug/release clean compile/link、模拟器与 arm64 真机 runtime、两次一致 clean run 和完整 hash 证据。

## 9. 未完成项与风险

按优先级排列：

1. **P2 仍是 imported IR，不是完整手写 canonical semantic IR。** 当前 contract 包含从旧 façade 提取的 declaration。下一步要把 operation request/response/error/raw policy 结构化，避免生成器只是搬运旧实现文本。
2. **PlatformDriver seam 未完成。** Android/iOS 只有 callback runtime；operation dispatch、native binding 和 codec 仍分散在 UTS/native façade。
3. **完整 codec golden 缺失。** 需要覆盖 missing/null/空串/0/false、大整数、畸形/嵌套 JSON、raw string identity，以及 iOS sparse writer。
4. **consumer probe 缺失。** 必须实际引用 109 constants、161 types、160 callables、48 events，防止未使用导出绕过编译。
5. **runtime lifecycle 压测缺失。** synchronous/background/out-of-order/duplicate/late callback、空/重复 operationID、100 次 init/login/logout/unInit、listener 累积与内存增长尚无权威证据。
6. **发布依赖等价性未证明。** Maven/Pod artifact 与本地锁定 artifact 的 hash/ABI 必须一致后才能解除 release block。
7. **生成目录策略未完成。** 最终要让 `uni_modules` 成为 bootstrap/release staging 输出，不再作为 main/private 合并源；切换前不能先删除当前 tracked 输出。
8. **automation 尚未成为发布门禁。** 当前页面覆盖逻辑很广，但仍需最小 consumer 与 Fake/Recording Driver 的 deterministic tests，不能只依赖 live server smoke。

## 10. 后续实施计划

### P0 收尾

- 保存 Android/iOS module compile 之外的 full-app consumer compile/link 证据。
- 建 invocation/response/rejection/event/lifecycle golden；比较字段存在性，不只比较 stringify。
- 对 Maven/Pod 与本地 artifact 做二进制/ABI 等价审计。

### P1 收尾

- 添加完整 consumer app，强制引用全部 Public 导出。
- 把 JDK/Xcode/设备信息和 generated source hash 纳入证据包。
- 为 compatibility exception 增加最小 probe 和到期检查。

### P2 完成

- 把 base contract 从“declaration snapshot”提升为结构化 operation/event/codec IR。
- 稳定数字 ID 只追加，不重排。
- 生成 concrete request writer、parser、error policy、operation/event binding switch 和 compile probes。
- 增加 duplicate/orphan/binding coverage、两次生成 determinism 和 artifact inventory。

### P3 完成

- 顺序仍是 Android 后 iOS。
- 把 native invocation 收进 PlatformDriver，UTS/native seam 只传 primitive/raw JSON/void callback。
- 保证所有 callback 只经 runtime 进入 UTS；禁止 façade 绕过。
- 增加 test-only Fake/Recording Driver，发布 inventory 明确排除。

### P4

- 依 setup/login、message、conversation、friendship、group、upload、event 顺序迁移 codec。
- 每个 semantic codec 只保留一个实现，真实平台差异最多进入一个 adapter。
- 固化 missing/null/raw fallback、iOS sparse/NSNumber/path 规则。
- differential 只出现在测试 artifact，不进入 production runtime。

### P5

- 单一提交原子切换 production composition。
- 删除旧 giant façade、重复 Promise/parser/event wrapper 和 native stub。
- 不保留 runtime flag、legacy fallback 或双栈。
- 运行 deletion test：删除旧 implementation 后新架构仍能生成、编译、链接、运行。

### P6

- 从 clean Public SHA 生成真实发布 artifact。
- 安装最小 consumer，执行 runtime matrix、inventory、license/secret scan、native hash 和 SBOM。
- 以已验证 SHA + artifact 为回滚单位。

## 11. 推荐的下一次工作顺序

1. 先合并/落地本 Public 分支，得到稳定 Public commit SHA。
2. 在 Private 分支合入该 Public commit，更新 Private 的 `PUBLIC_BASE_SHA`/base hash 证据。
3. 先完成 canonical codec IR 的一个垂直切片（建议 setup/login），不要一次把所有 operation 塞进通用 command bus。
4. 为该切片加入 Fake Driver、golden、consumer compile 和两端 custom-base runtime。
5. 通过 deletion test 后，再用同一模式迁移其他领域。
6. 所有领域完成后执行一次 P5 原子切换并删除 legacy，不在 production 中保留双栈。

## 12. 常用命令

```bash
npm ci
npm run typecheck:tooling
npm run test:tooling
npm run verify
npm run generate
npm run compile:android
npm run compile:ios
```

重新导入 surface 或 native ABI 是有意改变基线的操作，不应当作为普通修复执行：

```bash
npm run contract:import
npm run native:import
```

## 13. 不得提交/不得泄漏

- `.openim-test-accounts.json`
- `static/openim-test-config.json`
- `test-results/`
- `unpackage/`
- 真实 user token、admin token、测试账号和 server secret
- Harmony HAR、enterprise AAR/XCFramework、Private source 或 Private 测试证据

本提交保留了用户已有的 `package.json`、插件 `.npmignore` 以及相关 manifest/test 改动，没有用生成步骤覆盖这些迁移输入。
