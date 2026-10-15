package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	GouoChargeReserved   = "reserved"
	GouoChargeDispatched = "dispatched"
	GouoChargeSettled    = "settled"
	GouoChargeRefunded   = "refunded"
	// 超过请求时限仍未结算的请求按失败退款；留出余量，避免其他节点仍在处理时抢占
	GouoImageRecoveryDelay = 20 * time.Minute
)

// gouoTables 是光构新增的表，随 New API 的表一起迁移
var gouoTables = []any{&GouoImageCharge{}, &GouoTask{}, &GouoAsset{}, &GouoTaskAsset{}, &GouoFavoriteCollection{}, &GouoFavoriteItem{}, &GouoStorageQuota{}, &GouoDocument{}}

var ErrGouoChargeState = errors.New("请求账务状态已变化，请刷新后核对")
var ErrGouoImageRequestExists = errors.New("此图片请求已受理，请查询原任务；结果未知时请勿重新派发")
var ErrGouoInsufficientQuota = errors.New("余额不足")

// CreateGouoImageRequest 只登记去重与结果恢复；New API 负责新请求的全部扣费和退款。
func CreateGouoImageRequest(charge *GouoImageCharge) error {
	if charge.ID == "" || len(charge.ID) > 64 || charge.UserID <= 0 {
		return errors.New("图片请求无效")
	}
	charge.Quota, charge.PriceCNY, charge.Status = 0, 0, GouoChargeReserved
	err := DB.Create(charge).Error
	if err == nil {
		return nil
	}
	var count int64
	if DB.Model(&GouoImageCharge{}).Where("id = ?", charge.ID).Count(&count).Error == nil && count > 0 {
		return ErrGouoImageRequestExists
	}
	return err
}

// GouoImageRequestID 把客户端请求 ID 绑定到用户，不同用户用同一个 ID 不会冲突
func GouoImageRequestID(userID int, requestID string) string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userID, requestID)))
	return hex.EncodeToString(hash[:])
}

// GouoImageCharge 是一次图片请求的预扣记录。预扣在请求开始时落库，请求结束时结算或退回，
// 进程崩溃留下的预扣由定时任务退回，保证用户不会为没拿到的图片付费
type GouoImageCharge struct {
	ID             string  `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserID         int     `json:"user_id" gorm:"index:idx_gouo_charge_user_created,priority:1"`
	TokenID        int     `json:"-"`
	ChannelID      int     `json:"channel_id"`
	ModelName      string  `json:"model_name" gorm:"type:varchar(191)"`
	PriceCNY       float64 `json:"price_cny"`
	PriceVersion   string  `json:"price_version" gorm:"type:varchar(64)"`
	Quota          int     `json:"quota"`
	UnlimitedQuota bool    `json:"-"`
	Status         string  `json:"status" gorm:"type:varchar(20);index:idx_gouo_charge_status_updated,priority:1"`
	Attempts       int     `json:"attempts"`
	CreatedAt      int64   `json:"created_at" gorm:"autoCreateTime;index:idx_gouo_charge_user_created,priority:2"`
	UpdatedAt      int64   `json:"updated_at" gorm:"autoUpdateTime;index:idx_gouo_charge_status_updated,priority:2"`
	Note           string  `json:"note" gorm:"type:text"`
	// 后台列表展示用，不落库
	Username string `json:"username" gorm:"-"`
}

// ReserveGouoQuota 扣款与预扣记录同事务提交，记录写入失败不能留下预扣
func ReserveGouoQuota(charge *GouoImageCharge) error {
	if charge.ID == "" || len(charge.ID) > 64 || charge.Quota <= 0 || charge.Quota > math.MaxInt32 {
		return errors.New("图片请求或额度无效")
	}
	var token Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 先用空更新取得账号写锁（SQLite 没有 FOR UPDATE），同一用户的并发预扣排队执行，幂等检查不会竞态
		if err := tx.Model(&User{}).Where("id = ?", charge.UserID).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&GouoImageCharge{}).Where("id = ?", charge.ID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrGouoImageRequestExists
		}
		res := tx.Model(&User{}).Where("id = ? AND status = ? AND quota >= ?", charge.UserID, common.UserStatusEnabled, charge.Quota).UpdateColumn("quota", gorm.Expr("quota - ?", charge.Quota))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrGouoInsufficientQuota
		}
		if err := tx.Where("id = ? AND user_id = ? AND status = ? AND (expired_time = -1 OR expired_time >= ?)", charge.TokenID, charge.UserID, common.TokenStatusEnabled, common.GetTimestamp()).First(&token).Error; err != nil {
			return err
		}
		if !token.UnlimitedQuota {
			res = tx.Model(&Token{}).Where("id = ? AND remain_quota >= ?", charge.TokenID, charge.Quota).Updates(map[string]any{"remain_quota": gorm.Expr("remain_quota - ?", charge.Quota), "used_quota": gorm.Expr("used_quota + ?", charge.Quota)})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return errors.New("令牌额度不足")
			}
		}
		charge.UnlimitedQuota, charge.Status = token.UnlimitedQuota, GouoChargeReserved
		return tx.Create(charge).Error
	})
	if err == nil {
		invalidateGouoQuotaCache(charge.UserID, token.Key)
		return nil
	}
	// 并发首查都未命中时，主键冲突仍会回滚预扣，统一返回可识别的幂等冲突
	var count int64
	if DB.Model(&GouoImageCharge{}).Where("id = ?", charge.ID).Count(&count).Error == nil && count > 0 {
		return ErrGouoImageRequestExists
	}
	return err
}

func DispatchGouoImageCharge(id string, channelID int) error {
	res := DB.Model(&GouoImageCharge{}).Where("id = ? AND status IN ?", id, []string{GouoChargeReserved, GouoChargeDispatched}).Updates(map[string]any{"status": GouoChargeDispatched, "channel_id": channelID, "attempts": gorm.Expr("attempts + 1")})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrGouoChargeState
	}
	return nil
}

// FinishGouoImageCharge 用条件更新取得结算权，账务状态和额度一起成功或一起回滚；
// 日志可能在独立的日志库里，事务提交后再写
func FinishGouoImageCharge(id, status, note string) (*GouoImageCharge, error) {
	if status != GouoChargeSettled && status != GouoChargeRefunded {
		return nil, errors.New("账务操作无效")
	}
	var charge GouoImageCharge
	var token Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&GouoImageCharge{}).Where("id = ? AND status IN ?", id, []string{GouoChargeReserved, GouoChargeDispatched}).Updates(map[string]any{"status": status, "note": note})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrGouoChargeState
		}
		if err := tx.Where("id = ?", id).First(&charge).Error; err != nil {
			return err
		}
		if charge.Quota == 0 {
			return nil
		}
		if err := tx.Unscoped().Select("id", "key").First(&token, charge.TokenID).Error; err != nil {
			return err
		}
		if status == GouoChargeSettled {
			return nil
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", charge.UserID).UpdateColumn("quota", gorm.Expr("quota + ?", charge.Quota)).Error; err != nil {
			return err
		}
		if charge.UnlimitedQuota {
			return nil
		}
		if err := tx.Unscoped().Model(&Token{}).Where("id = ?", charge.TokenID).Updates(map[string]any{"remain_quota": gorm.Expr("remain_quota + ?", charge.Quota), "used_quota": gorm.Expr("used_quota - ?", charge.Quota)}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Model(&Token{}).Where("id = ? AND status = ? AND remain_quota > 0", charge.TokenID, common.TokenStatusExhausted).UpdateColumn("status", common.TokenStatusEnabled).Error
	})
	if err != nil {
		return nil, err
	}
	if charge.Quota == 0 {
		return &charge, nil
	}
	invalidateGouoQuotaCache(charge.UserID, token.Key)
	if status == GouoChargeSettled {
		UpdateUserUsedQuotaAndRequestCount(charge.UserID, charge.Quota)
		UpdateChannelUsedQuota(charge.ChannelID, charge.Quota)
		return &charge, nil
	}
	RecordLog(charge.UserID, LogTypeRefund, common.NewMessage("图片预扣退款：{{note}}", map[string]any{"note": note}))
	return &charge, nil
}

type GouoImageChargeFilter struct {
	UserID int
	ID     string
	Status string
	// 大于 0 时只返回权限低于该等级的账号的记录（含已删除账号）
	BelowRole int
}

// ListGouoImageCharges 按创建时间倒序分页列出图片预扣账本，并带上用户名
func ListGouoImageCharges(filter GouoImageChargeFilter, offset, limit int) ([]*GouoImageCharge, int64, error) {
	query := DB.Model(&GouoImageCharge{})
	if filter.UserID > 0 {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if filter.BelowRole > 0 {
		query = query.Where("user_id IN (?)", DB.Unscoped().Model(&User{}).Select("id").Where("role < ?", filter.BelowRole))
	}
	if filter.ID != "" {
		query = query.Where("id = ?", filter.ID)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := make([]*GouoImageCharge, 0)
	if err := query.Order("created_at DESC, id DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	var users []User
	if len(ids) > 0 {
		if err := DB.Unscoped().Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return nil, 0, err
		}
	}
	names := map[int]string{}
	for _, user := range users {
		names[user.Id] = user.Username
	}
	for _, row := range rows {
		row.Username = names[row.UserID]
	}
	return rows, total, nil
}

// RecoverGouoImageCharges 退回超时未结算的预扣，并清理过期的图片恢复结果
func RecoverGouoImageCharges() error {
	cutoff := time.Now().Add(-GouoImageRecoveryDelay).Unix()
	var stale []GouoImageCharge
	if err := DB.Where("status IN ? AND updated_at < ?", []string{GouoChargeReserved, GouoChargeDispatched}, cutoff).Limit(100).Find(&stale).Error; err != nil {
		return err
	}
	for _, charge := range stale {
		if _, err := FinishGouoImageCharge(charge.ID, GouoChargeRefunded, "请求中断，未返回图片，自动退回积分"); err != nil && !errors.Is(err, ErrGouoChargeState) {
			return err
		}
	}
	return CleanupGouoImageResults()
}

// RunGouoJobs 每分钟退回超时预扣，每小时清理过期的回收站；
// 结算和清理都带条件或行锁，多实例同时运行也只会处理一次
func RunGouoJobs() {
	var lastPurge time.Time
	for {
		if time.Since(lastPurge) >= time.Hour {
			lastPurge = time.Now()
			if err := PurgeGouoTrash(lastPurge); err != nil {
				common.SysError("清理云端回收站失败: " + err.Error())
			}
		}
		if err := RecoverGouoImageCharges(); err != nil {
			common.SysError("gouo image recovery failed: " + err.Error())
		}
		time.Sleep(time.Minute)
	}
}

func invalidateGouoQuotaCache(userID int, key string) {
	if err := invalidateUserCache(userID); err != nil {
		common.SysError("invalidate user cache failed: " + err.Error())
	}
	if err := invalidateTokenCacheForMutation(key); err != nil {
		common.SysError("invalidate token cache failed: " + err.Error())
	}
}
