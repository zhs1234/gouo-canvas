# 双数据库冷备份与空目标恢复

当前工具只用于明确的本地合成验收实例。固定 New API 与 Studio 的两个 SQLite 库是一个配对恢复单元：Native 保存账号、令牌、订阅与真实网关记录；Studio 保存归属、历史、原图 BLOB、项目版本和任务。不能只恢复其中一个，也不能把另一实例的同数值 owner ID 当作本人。

`v2/scripts/backup-restore.mjs` 提供 inspect、backup、verify、restore-empty。Node 要求沿 `v2/package.json` 的 >=22.16.0，使用内建 SQLite backup，没有新依赖。实际命令结果见 [SYSTEM-INTEGRATION-STATUS.md](SYSTEM-INTEGRATION-STATUS.md)。工具不会初始化账号、构造业务模块、启动/停止服务、调用模型、释放 held 或核对资金。

## 操作条件

源必须是该 workspace `.local` 下的随机 `gouo-user-acceptance-*` 项目，固定 source/binary、明确本地零采购供应商和普通合成账号。仅使用完整 64 位 Native/Studio 容器 ID；核对本项目标签、私有网络、实际镜像、配置、政策、稳定 instance UUID 和独立数据卷。其他项目只读取容器运行/挂载/网络元数据，不读取其环境变量或账号数据。

先由操作者停止源 web、Studio、Native，确认 Native/Studio Pid0，保留容器和卷。不要调用 acceptance helper 的 stop，它执行 down --volumes。不要在活跃请求、claiming/reserved/pending 资金写、accepted/ready/submitted/output_received/output_saved 图片任务期间备份。历史 unknown 与 held 会原样保存，不自动解除；无法确认完成时先解决原状态。

备份库本身包含合成实例的敏感数据，存放在全新私有 `.local` 目录，不提交或发布。JSON 只记录 hash、ID、count、revision 和 held 等诊断。生产加密、密钥托管、保留/销毁和跨实例恢复认证仍是独立门项；此工具拒绝日常或生产实例，不能替代生产备份方案。

## 创建与验证

从 `v2` 执行，尖括号值由操作者填写，不直接复制运行：

```powershell
node scripts/backup-restore.mjs inspect --state <source-state> --native-container <full-id> --studio-container <full-id> --confirm-synthetic-private
node scripts/backup-restore.mjs backup --state <source-state> --native-container <full-id> --studio-container <full-id> --out .local/<new-private-directory> --confirm-synthetic-private
node scripts/backup-restore.mjs verify --backup .local/<new-private-directory> --confirm-synthetic-private
```

工具从冷容器复制 /data 到自己临时目录，包含尚未 checkpoint 的 WAL；再通过 SQLite backup() 生成两个规范库。它不对原卷 checkpoint。配对 manifest 绑定原 instance、实际二进制/镜像、配置及密钥 hash、源码/政策 hash、完整 schema/逻辑数据 hash、原图字节 hash 和 owner 关系。verify 只读本地文件，零 Docker/模型操作。路径链接、旧输出目录、漂移、混合库、损坏或外户引用均拒绝。

冷容器的 API 源码、政策目录及验收入口均实际复制并比对批准 hash，在操作开始和最终复核重复检查；不只相信声明的 host bind。受保护路径的重复、祖先/子项遮蔽以及 /data 子挂载拒绝。Windows Docker Desktop 仅允许 API bind 的精确 `/run/desktop/mnt/host/<drive>/<suffix>` 显示别名，并通过实际源码核验；不放宽其他路径或可写挂载。验证之后 Docker 管理员仍可变更环境，本工具不提供该竞态的原子隔离保证。

## 恢复到新的空卷

保留原源冷停止。人工准备另一个随机 project、loopback 端口、目录及两个新空卷；保留同 instance UUID、SESSION/CRYPTO 配置、实际镜像、API源码、政策和开关。生产默认随机 SESSION_SECRET 的重启语义不能推定可恢复；本合成实例使用明确稳定的合成 SESSION_SECRET。

只执行目标 Compose create，不执行 acceptance start 或账号初始化。目标 Native/Studio 应为 created/Pid0，卷为空，源和目标卷完全不同。目标源码/配置/密钥/版本与源精确一致，不能通过关闭开关或改模型掩盖漂移。

先固定备份对应的源码版本和供应商设施文件，再创建目标；之后开发改动会使旧manifest的源码hash不再匹配，应使用对应提交恢复，不能重写manifest绕过核验。2026-10-02合成演练已实际恢复同实例账号、原图、revision2、任务和unknown held，并用普通身份验证本人/异户/匿名读取；具体失败及成功证据见状态文档。

```powershell
node scripts/backup-restore.mjs restore-empty --state <source-state> --native-container <source-full-id> --studio-container <source-full-id> --backup .local/<private-backup> --target-state <target-state> --target-native-container <target-full-id> --target-studio-container <target-full-id> --confirm-synthetic-private
```

离线 helper 使用固定 Studio 镜像、network none、只读 root filesystem，仅写两个新空卷。双库都验证通过，并复核源/目标仍冷停止后，才写 restore-ready receipt，operatorMayStartVerifiedPair=true。工具本身仍不启动服务；操作者核对 receipt 后只启动目标，不同时启动两个可写副本。

启动后用普通身份实际验证本人原项目/revision、精确原图 hash、历史失败/unknown、旧 held、异户与匿名拒绝，以及读取期间零模型/资金写。若复制、验证或恢复中途失败，保留部分新目标/报告，继续冷停止；不要覆盖原卷、盲目重试业务请求或启动只恢复一半的库。
