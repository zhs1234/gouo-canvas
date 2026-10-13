package config

var GouoCloudLibraryEnabled = true
var GouoAssetDir = "./data/gouo-assets"
var GouoAssetUserQuotaBytes int64 = 2 * 1024 * 1024 * 1024
var GouoAssetMaxFileBytes int64 = 25 * 1024 * 1024
var GouoAssetMaxTaskFiles = 32

// 回收站保留天数；作品、画布、会话、收藏夹和已删除账号的云端数据都按此保留
var GouoTrashRetentionDays = 3
