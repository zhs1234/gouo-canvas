package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"one-api/common/config"
	"one-api/common/redis"
	"one-api/common/utils"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	GouoChargeReserved   = "reserved"
	GouoChargeDispatched = "dispatched"
	GouoChargeReview     = "needs_review"
	GouoChargeSettled    = "settled"
	GouoChargeRefunded   = "refunded"
	// 图片代理最多等待 15 分钟，恢复窗口留出 5 分钟，避免其他节点仍在处理时抢占。
	GouoImageRequestTimeout = 15 * time.Minute
	GouoImageRecoveryDelay  = 20 * time.Minute
)

var ErrGouoChargeState = errors.New("请求账务状态已变化，请刷新后核对")
var ErrGouoImageRequestExists = errors.New("此图片请求已受理，请查询原任务；结果未知时请勿重新派发")

func GouoImageRequestID(userID int, requestID string) string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userID, requestID)))
	return hex.EncodeToString(hash[:])
}

type GouoImageCharge struct {
	ID             string  `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserID         int     `json:"user_id" gorm:"index:idx_gouo_charge_user_created,priority:1"`
	TokenID        int     `json:"-"`
	ChannelID      int     `json:"channel_id"`
	ModelName      string  `json:"model_name" gorm:"type:varchar(255)"`
	PriceCNY       float64 `json:"price_cny"`
	PriceVersion   string  `json:"price_version" gorm:"type:varchar(64)"`
	Quota          int     `json:"quota"`
	UnlimitedQuota bool    `json:"-"`
	Status         string  `json:"status" gorm:"type:varchar(20);index:idx_gouo_charge_status_updated,priority:1"`
	Attempts       int     `json:"attempts"`
	CreatedAt      int64   `json:"created_at" gorm:"autoCreateTime;index:idx_gouo_charge_user_created,priority:2"`
	UpdatedAt      int64   `json:"updated_at" gorm:"autoUpdateTime;index:idx_gouo_charge_status_updated,priority:2"`
	LogID          int     `json:"log_id"`
	ResolvedBy     int     `json:"resolved_by"`
	Note           string  `json:"note" gorm:"type:text"`
}

// 扣款与持久请求记录同事务提交，记录写入失败不能留下预扣。
func ReserveGouoQuota(charge *GouoImageCharge) error {
	if charge.ID == "" || len(charge.ID) > 64 || charge.Quota <= 0 || charge.Quota > math.MaxInt32 {
		return errors.New("图片请求或额度无效")
	}
	var token Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 先取得账号写锁，避免 SQLite 的并发读事务升级锁导致幂等检查竞态。
		if err := tx.Model(&User{}).Where("id = ?", charge.UserID).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
			return err
		}
		var existing GouoImageCharge
		if err := tx.Where("id = ? AND user_id = ?", charge.ID, charge.UserID).First(&existing).Error; err == nil {
			return ErrGouoImageRequestExists
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		res := tx.Model(&User{}).Where("id = ? AND status = ? AND quota >= ?", charge.UserID, config.UserStatusEnabled, charge.Quota).UpdateColumn("quota", gorm.Expr("quota - ?", charge.Quota))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return errors.New("用户余额不足")
		}
		if err := tx.Where("id = ? AND user_id = ? AND status = ? AND (expired_time = -1 OR expired_time >= ?)", charge.TokenID, charge.UserID, config.TokenStatusEnabled, utils.GetTimestamp()).First(&token).Error; err != nil {
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
	} else {
		// 并发首查都未命中时，主键冲突仍会回滚预扣，并统一返回可识别的幂等冲突。
		var existing GouoImageCharge
		if DB.Where("id = ? AND user_id = ?", charge.ID, charge.UserID).First(&existing).Error == nil {
			return ErrGouoImageRequestExists
		}
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

func ReviewGouoImageCharge(id, note string) error {
	return DB.Model(&GouoImageCharge{}).Where("id = ? AND status = ?", id, GouoChargeDispatched).Updates(map[string]any{"status": GouoChargeReview, "note": note}).Error
}

// 条件更新取得结算权；账务状态、额度、统计和日志必须一起成功或一起回滚。
func FinishGouoImageCharge(id, expected, status string, log *Log, actor int, note string) error {
	if status != GouoChargeSettled && status != GouoChargeRefunded {
		return errors.New("账务操作无效")
	}
	if expected != GouoChargeReserved && expected != GouoChargeDispatched && expected != GouoChargeReview {
		return ErrGouoChargeState
	}
	var charge GouoImageCharge
	var token Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&GouoImageCharge{}).Where("id = ? AND status = ?", id, expected).Updates(map[string]any{"status": status, "resolved_by": actor, "note": note})
		if res.Error != nil {
			return res.Error
		}
		if err := tx.Where("id = ?", id).First(&charge).Error; err != nil {
			return err
		}
		if res.RowsAffected != 1 {
			if charge.Status == status {
				return nil
			}
			return ErrGouoChargeState
		}
		var user User
		if err := tx.Unscoped().First(&user, charge.UserID).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().First(&token, charge.TokenID).Error; err != nil {
			return err
		}
		if log == nil {
			log = &Log{}
		}
		log.Id, log.UserId, log.Username, log.TokenName = 0, charge.UserID, user.Username, token.Name
		log.CreatedAt, log.ModelName, log.ChannelId, log.Quota = time.Now().Unix(), charge.ModelName, charge.ChannelID, charge.Quota
		meta := log.Metadata.Data()
		if meta == nil {
			meta = map[string]any{}
		}
		meta["request_id"], meta["price_cny"], meta["price_version"] = charge.ID, charge.PriceCNY, charge.PriceVersion
		meta["billing_status"], meta["charged_quota"], meta["resolved_by"] = status, charge.Quota, actor
		if status == GouoChargeSettled {
			log.Type = LogTypeConsume
			meta["billing_unit"] = "successful_request"
			if err := tx.Unscoped().Model(&User{}).Where("id = ?", charge.UserID).Updates(map[string]any{"used_quota": gorm.Expr("used_quota + ?", charge.Quota), "request_count": gorm.Expr("request_count + 1")}).Error; err != nil {
				return err
			}
			if err := tx.Unscoped().Model(&Channel{}).Where("id = ?", charge.ChannelID).UpdateColumn("used_quota", gorm.Expr("used_quota + ?", charge.Quota)).Error; err != nil {
				return err
			}
		} else {
			log.Type, log.Content = LogTypeSystem, "图片预扣退款："+note
			meta["charged_quota"], meta["reserved_quota"] = 0, charge.Quota
			meta["billing_unit"] = "refunded_request"
			if err := tx.Unscoped().Model(&User{}).Where("id = ?", charge.UserID).UpdateColumn("quota", gorm.Expr("quota + ?", charge.Quota)).Error; err != nil {
				return err
			}
			if !charge.UnlimitedQuota {
				if err := tx.Unscoped().Model(&Token{}).Where("id = ?", charge.TokenID).Updates(map[string]any{"remain_quota": gorm.Expr("remain_quota + ?", charge.Quota), "used_quota": gorm.Expr("used_quota - ?", charge.Quota)}).Error; err != nil {
					return err
				}
				if err := tx.Unscoped().Model(&Token{}).Where("id = ? AND status = ? AND remain_quota > 0", charge.TokenID, config.TokenStatusExhausted).UpdateColumn("status", config.TokenStatusEnabled).Error; err != nil {
					return err
				}
			}
		}
		if actor > 0 {
			log.Content = "管理员核对图片请求：" + note
		}
		log.Metadata = datatypes.NewJSONType(meta)
		if err := tx.Create(log).Error; err != nil {
			return err
		}
		return tx.Model(&charge).UpdateColumn("log_id", log.Id).Error
	})
	if err == nil {
		invalidateGouoQuotaCache(charge.UserID, token.Key)
	}
	return err
}

func RecoverGouoImageCharges() error {
	cutoff := time.Now().Add(-GouoImageRecoveryDelay).Unix()
	var reserved []GouoImageCharge
	if err := DB.Where("status = ? AND updated_at < ?", GouoChargeReserved, cutoff).Limit(100).Find(&reserved).Error; err != nil {
		return err
	}
	for _, charge := range reserved {
		if err := FinishGouoImageCharge(charge.ID, GouoChargeReserved, GouoChargeRefunded, nil, 0, "请求中断且未发送上游，自动恢复额度"); err != nil && !errors.Is(err, ErrGouoChargeState) {
			return err
		}
	}
	if err := DB.Model(&GouoImageCharge{}).Where("status = ? AND updated_at < ?", GouoChargeDispatched, cutoff).Updates(map[string]any{"status": GouoChargeReview, "note": "请求中断，上游结果未知，请核对渠道记录后结算或退款"}).Error; err != nil {
		return err
	}
	return CleanupGouoImageResults()
}

func ResolveGouoImageCharge(id, status string, actor int, note string) error {
	note = strings.TrimSpace(note)
	if actor < 1 || note == "" || len([]rune(note)) > 1000 {
		return errors.New("请填写不超过 1000 字的核对依据")
	}
	return FinishGouoImageCharge(id, GouoChargeReview, status, nil, actor, note)
}

// ListGouoImageCharges belowRole 大于 0 时只返回权限低于该等级的账号的记录（含已删除账号）。
func ListGouoImageCharges(userID, belowRole int, id, status string, params *PaginationParams) (*DataResult[GouoImageCharge], error) {
	query := DB.Model(&GouoImageCharge{})
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if belowRole > 0 {
		query = query.Where("user_id IN (?)", DB.Unscoped().Model(&User{}).Select("id").Where("role < ?", belowRole))
	}
	if id != "" {
		query = query.Where("id = ?", id)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var rows []*GouoImageCharge
	return PaginateAndOrder(query.Order("created_at DESC, id DESC"), params, &rows, map[string]bool{})
}

func invalidateGouoQuotaCache(userID int, key string) {
	if !config.RedisEnabled {
		return
	}
	redis.RedisDel(fmt.Sprintf(UserQuotaCacheKey, userID))
	if key != "" {
		redis.RedisDel(fmt.Sprintf(UserTokensKey, key))
	}
}
