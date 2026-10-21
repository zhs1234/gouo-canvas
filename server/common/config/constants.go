package config

import (
	"time"

	"github.com/google/uuid"
)

var StartTime = time.Now().Unix() // unit: second
var Version = "v0.0.0"            // this hard coding will be replaced automatically when building, no need to manually change
var Commit = "unknown"
var BuildTime = "unknown"
var SystemName = "光构"
var ServerAddress = "http://localhost:3000"
var Debug = false

var Language = ""
var Footer = ""
var Logo = ""
var TopUpLink = ""
var GouoRedemptionHelp = ""
var GouoSupportContact = ""

// GouoNotice 是客户端创作页顶部的公告，留空时显示默认介绍
var GouoNotice = ""

// 客户端功能开关、Agent 与生成限制，由后台“光构设置”维护；画布和 Agent 仍受前端构建开关约束
var GouoCanvasEnabled = true
var GouoAgentEnabled = true
var GouoAgentDefaultModel = ""
var GouoAgentSystemPrompt = ""

// 内置的网站使用说明，用户问到本站用法时 Agent 通过 read_site_guide 工具按需读取；后台可修改，清空后不再提供
var GouoAgentSiteGuide = `- 创作页顶部切换 Agent、生成图片、画布三种方式；运营方可能关闭画布或 Agent。
- 生成图片：在输入框描述画面，选择图片模型，可在"自定义参数"设置尺寸、质量、格式和张数；输入框下方显示预计扣费，按成功张数计费。可上传、拖拽或粘贴参考图，输入 @ 引用参考图；点参考图的编辑入口选"添加遮罩"可局部修改，需所选模型支持。
- 画布：在"我的画布"新建。底部工具栏添加文本、图片、生成配置和组节点；在生成配置节点点"生成图片"，结果连在右侧，连入的文本和图片作为补充提示词和参考图。画布右上角"Agent"打开关联当前画布的对话。
- Agent：可选择对话模型和图片模型、关联画布、添加参考图；Enter 发送，Shift + Enter 换行，生成中可以停止。图片任务按图片模型价格计费，对话按文本用量计费；单条消息生成较多图片时会先请用户确认。点"技能"或在消息里写 $名称 启用技能，每个会话最多 4 个；"设置 → 技能"可查看、启停和导入技能。
- 我的作品：可搜索、按状态筛选（含回收站）；点击图片查看详情、下载、复用配置或编辑输出；支持多选后批量下载、收藏和删除。作品可加入多个收藏夹，删除收藏夹不会删除作品。
- 灵感库：按分类浏览提示词模板，"填入提示词"会写入生成图片输入框，方括号里的占位内容需要替换。
- 积分：1 元 = 100 积分。点右上角余额或头像打开用户中心，在"充值积分"输入兑换码到账；"使用记录"可按类型、模型、日期筛选并导出 CSV。没有返回图片的请求会自动退回积分。
- 云端保存：作品、收藏夹、画布和会话随账号保存，换设备登录同一账号即可看到。删除的内容进入回收站，保留期以界面提示为准，到期后彻底删除。本机旧作品需在"用户中心 → 导入本机旧作品"手动导入。
- 设置（右上角齿轮）：提交快捷键、参考图编辑方式、技能，以及"数据管理"里的 ZIP 备份导出和导入。
- 常见问题：提示"无效的令牌"或 HTTP 401 时退出后重新登录；积分不足时先用兑换码充值，再点任务上的"重试"（重试会新建付费请求）；请求被安全系统拒绝时修改可能敏感的内容后重试；图片上传失败时换用 PNG、JPEG 或 WebP，或减小文件；换设备看不到作品时确认登录的是同一账号；平台统一管理上游接口，用户不需要填写 API Key。`

var GouoMaxImagesPerTask = 10

// 是否允许用户把上游审核调成宽松（moderation=low）；默认不允许，由运营方决定
var GouoAllowLowModeration = false

// Agent 每条用户消息最多调用几轮工具，以及单条消息合计超过多少张图片时先请用户确认
var GouoAgentMaxRounds = 8
var GouoAgentConfirmImages = 4

// Agent 技能：是否开放、是否允许用户导入，以及普通用户能否从 GitHub 链接导入（管理员始终可以）
var GouoSkillsEnabled = true
var GouoSkillImportEnabled = true
var GouoSkillGithubImport = false

// GouoDefaultImageModel 是客户端未手动选择模型时使用的图片模型；为空或不可用时取目录中的第一个
var GouoDefaultImageModel = ""
var ChatLink = ""
var ChatLinks = ""
var AnalyticsCode = ""
var QuotaPerUnit = 500 * 1000.0 // $0.002 / 1K tokens
var DisplayInCurrencyEnabled = true

// 是否开启用户月账单功能
var UserInvoiceMonth = false

// Any options with "Secret", "Token" in its key won't be return by GetOptions

var SessionSecret = uuid.New().String()

var ItemsPerPage = 10
var MaxRecentItems = 100

var PasswordLoginEnabled = true
var PasswordRegisterEnabled = true
var EmailVerificationEnabled = false
var GitHubOAuthEnabled = false
var WeChatAuthEnabled = false
var LarkAuthEnabled = false
var TurnstileCheckEnabled = false
var RegisterEnabled = true
var OIDCAuthEnabled = false

// 是否开启内容审查
var EnableSafe = false

// 默认使用系统自带关键词审查工具
var SafeToolName = "Keyword"

// 系统自带关键词审查默认字典
var SafeKeyWords = []string{
	"fuck",
	"shit",
	"bitch",
	"pussy",
	"cunt",
	"dick",
	"asshole",
	"bastard",
	"slut",
	"whore",
	"nigger",
	"nigga",
	"nazi",
	"gay",
	"lesbian",
	"transgender",
	"queer",
	"homosexual",
	"incest",
	"rape",
	"rapist",
	"raped",
	"raping",
	"raped",
	"raping",
	"rapist",
	"rape",
	"sex",
	"sexual",
	"sexually",
	"sexualize",
	"sexualized",
	"sexualizes",
	"sexualizing",
	"sexually",
	"sex",
	"porn",
	"pornography",
	"prostitute",
	"prostitution",
	"masturbate",
	"masturbation",
	"pedophile",
	"pedophilia",
	"hentai",
	"explicit",
	"obscene",
	"obscenity",
	"erotic",
	"erotica",
	"fetish",
	"NSFW",
	"nude",
	"nudity",
	"harassment",
	"abuse",
	"violent",
	"violence",
	"suicide",
	"racist",
	"racism",
	"discrimination",
	"hate",
	"terrorism",
	"terrorist",
	"drugs",
	"cocaine",
	"heroin",
	"methamphetamine",
}

// mj
var MjNotifyEnabled = false

var EmailDomainRestrictionEnabled = false
var EmailDomainWhitelist = []string{
	"gmail.com",
	"163.com",
	"126.com",
	"qq.com",
	"outlook.com",
	"hotmail.com",
	"icloud.com",
	"yahoo.com",
	"foxmail.com",
}

var MemoryCacheEnabled = false

var LogConsumeEnabled = true

var SMTPServer = ""
var SMTPPort = 587
var SMTPAccount = ""
var SMTPFrom = ""
var SMTPToken = ""

var ChatImageRequestProxy = ""

var GitHubProxy = ""
var GitHubClientId = ""
var GitHubClientSecret = ""
var GitHubOldIdCloseEnabled = false

var LarkClientId = ""
var LarkClientSecret = ""

var WeChatServerAddress = ""
var WeChatServerToken = ""
var WeChatAccountQRCodeImageURL = ""

var TurnstileSiteKey = ""
var TurnstileSecretKey = ""

var OIDCClientId = ""
var OIDCClientSecret = ""
var OIDCIssuer = ""
var OIDCScopes = ""
var OIDCUsernameClaims = ""

var QuotaForNewUser = 0
var QuotaForInviter = 0
var QuotaForInvitee = 0
var ChannelDisableThreshold = 5.0
var AutomaticDisableChannelEnabled = false
var AutomaticEnableChannelEnabled = false
var QuotaRemindThreshold = 1000
var PreConsumedQuota = 500
var ApproximateTokenEnabled = false
var DisableTokenEncoders = false
var RetryTimes = 0
var RetryTimeOut = 10

var DefaultChannelWeight = uint(1)
var RetryCooldownSeconds = 5

var CFWorkerImageUrl = ""
var CFWorkerImageKey = ""

var RootUserEmail = ""

var IsMasterNode = true

var RequestInterval time.Duration

var BatchUpdateEnabled = false
var BatchUpdateInterval = 5

var MCP_ENABLE = false

var UPTIMEKUMA_ENABLE = false
var UPTIMEKUMA_DOMAIN = ""
var UPTIMEKUMA_STATUS_PAGE_NAME = ""

// Gemini
var GeminiAPIEnabled = true

// Claude
var ClaudeAPIEnabled = true

const (
	RoleGuestUser    = 0
	RoleCommonUser   = 1
	RoleReliableUser = 3 // 可信的内部员工
	RoleAdminUser    = 10
	RoleRootUser     = 100
)

var RateLimitKeyExpirationDuration = 20 * time.Minute

const (
	UserStatusEnabled  = 1 // don't use 0, 0 is the default value!
	UserStatusDisabled = 2 // also don't use 0
)

const (
	TokenStatusEnabled   = 1 // don't use 0, 0 is the default value!
	TokenStatusDisabled  = 2 // also don't use 0
	TokenStatusExpired   = 3
	TokenStatusExhausted = 4
)

const (
	RedemptionCodeStatusEnabled  = 1 // don't use 0, 0 is the default value!
	RedemptionCodeStatusDisabled = 2 // also don't use 0
	RedemptionCodeStatusUsed     = 3 // also don't use 0
)

const (
	ChannelStatusUnknown          = 0
	ChannelStatusEnabled          = 1 // don't use 0, 0 is the default value!
	ChannelStatusManuallyDisabled = 2 // also don't use 0
	ChannelStatusAutoDisabled     = 3
)

const (
	ChannelTypeUnknown = 0
	ChannelTypeOpenAI  = 1
	// ChannelTypeAPI2D          = 2
	ChannelTypeAzure = 3
	// ChannelTypeCloseAI = 4
	// ChannelTypeOpenAISB       = 5
	// ChannelTypeOpenAIMax      = 6
	// ChannelTypeOhMyGPT        = 7
	ChannelTypeCustom = 8
	// ChannelTypeAILS           = 9
	// ChannelTypeAIProxy        = 10
	ChannelTypePaLM = 11
	// ChannelTypeAPI2GPT        = 12
	// ChannelTypeAIGC2D         = 13
	ChannelTypeAnthropic  = 14
	ChannelTypeBaidu      = 15
	ChannelTypeZhipu      = 16
	ChannelTypeAli        = 17
	ChannelTypeXunfei     = 18
	ChannelType360        = 19
	ChannelTypeOpenRouter = 20
	// ChannelTypeAIProxyLibrary = 21
	// ChannelTypeFastGPT        = 22
	ChannelTypeTencent         = 23
	ChannelTypeAzureSpeech     = 24
	ChannelTypeGemini          = 25
	ChannelTypeBaichuan        = 26
	ChannelTypeMiniMax         = 27
	ChannelTypeDeepseek        = 28
	ChannelTypeMoonshot        = 29
	ChannelTypeMistral         = 30
	ChannelTypeGroq            = 31
	ChannelTypeBedrock         = 32
	ChannelTypeLingyi          = 33
	ChannelTypeMidjourney      = 34
	ChannelTypeCloudflareAI    = 35
	ChannelTypeCohere          = 36
	ChannelTypeStabilityAI     = 37
	ChannelTypeCoze            = 38
	ChannelTypeOllama          = 39
	ChannelTypeHunyuan         = 40
	ChannelTypeSuno            = 41
	ChannelTypeVertexAI        = 42
	ChannelTypeLLAMA           = 43
	ChannelTypeIdeogram        = 44
	ChannelTypeSiliconflow     = 45
	ChannelTypeFlux            = 46
	ChannelTypeJina            = 47
	ChannelTypeRerank          = 48
	ChannelTypeGithub          = 49
	ChannelTypeRecraft         = 51
	ChannelTypeReplicate       = 52
	ChannelTypeKling           = 53
	ChannelTypeAzureDatabricks = 54
	ChannelTypeAzureV1         = 55
	ChannelTypeXAI             = 56
)

const (
	RelayModeUnknown = iota
	RelayModeChatCompletions
	RelayModeCompletions
	RelayModeEmbeddings
	RelayModeModerations
	RelayModeImagesGenerations
	RelayModeImagesEdits
	RelayModeImagesVariations
	RelayModeEdits
	RelayModeAudioSpeech
	RelayModeAudioTranscription
	RelayModeAudioTranslation
	RelayModeSuno
	RelayModeRerank
	RelayModeChatRealtime
	RelayModeKling
	RelayModeResponses
)

type ContextKey string
