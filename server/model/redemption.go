package model

import (
	"errors"
	"fmt"
	"math"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"one-api/common"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/utils"
)

type Redemption struct {
	Id             int    `json:"id"`
	UserId         int    `json:"user_id"`
	Key            string `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status         int    `json:"status" gorm:"default:1"`
	Name           string `json:"name" gorm:"index"`
	Quota          int    `json:"quota" gorm:"default:100"`
	CreatedTime    int64  `json:"created_time" gorm:"bigint"`
	RedeemedTime   int64  `json:"redeemed_time" gorm:"bigint"`
	RedeemedUserId int    `json:"redeemed_user_id" gorm:"default:0;index"`
	RedeemedLogId  int    `json:"redeemed_log_id" gorm:"default:0"`
	Count          int    `json:"count" gorm:"-:all"` // only for api request
}

// 用户余额在 SQL 中使用有符号 INT，面额和到账后的余额均不能溢出。
const maxRedemptionQuota = math.MaxInt32

func validateRedemptionQuota(quota int) error {
	if quota <= 0 || int64(quota) > maxRedemptionQuota {
		return errors.New("兑换额度必须为正整数且不超过 2147483647")
	}
	return nil
}

var allowedRedemptionslOrderFields = map[string]bool{
	"id":            true,
	"name":          true,
	"status":        true,
	"quota":         true,
	"created_time":  true,
	"redeemed_time": true,
}

func GetRedemptionsList(params *GenericParams) (*DataResult[Redemption], error) {
	var redemptions []*Redemption
	db := DB
	if params.Keyword != "" {
		db = db.Where("name LIKE ?", params.Keyword+"%").Or(clause.Eq{Column: "key", Value: params.Keyword})
		if id := utils.String2Int(params.Keyword); id > 0 {
			db = db.Or("id = ? OR redeemed_user_id = ?", id, id)
		}
	}

	return PaginateAndOrder[Redemption](db, &params.PaginationParams, &redemptions, allowedRedemptionslOrderFields)
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

func Redeem(key string, userId int, ip string) (quota int, err error) {
	if key == "" {
		return 0, errors.New("未提供兑换码")
	}
	if userId == 0 {
		return 0, errors.New("无效的 user id")
	}
	redemption := &Redemption{}

	err = DB.Transaction(func(tx *gorm.DB) error {
		// 先原子认领再读面额；同一码的停用、改额和并发兑换都受数据库行锁约束。
		claimed := tx.Model(&Redemption{}).Where(clause.Eq{Column: "key", Value: key}).
			Where("status = ? AND redeemed_time = 0 AND quota > 0 AND quota <= ?", config.RedemptionCodeStatusEnabled, maxRedemptionQuota).
			Updates(map[string]any{"status": config.RedemptionCodeStatusUsed, "redeemed_time": utils.GetTimestamp(), "redeemed_user_id": userId})
		if claimed.Error != nil {
			return claimed.Error
		}
		if err := tx.Where(clause.Eq{Column: "key", Value: key}).First(redemption).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("无效的兑换码")
			}
			return err
		}
		if claimed.RowsAffected != 1 {
			if redemption.Status == config.RedemptionCodeStatusDisabled {
				return errors.New("该兑换码已停用")
			}
			if err := validateRedemptionQuota(redemption.Quota); err != nil {
				return err
			}
			return errors.New("该兑换码已被使用")
		}
		credited := tx.Model(&User{}).Where("id = ? AND status = ? AND quota <= ?", userId, config.UserStatusEnabled, maxRedemptionQuota-redemption.Quota).
			Update("quota", gorm.Expr("quota + ?", redemption.Quota))
		if credited.Error != nil {
			return credited.Error
		}
		if credited.RowsAffected != 1 {
			return errors.New("用户不可充值或余额超出范围")
		}
		var user User
		if err := tx.Select("username").First(&user, userId).Error; err != nil {
			return err
		}
		log := Log{UserId: userId, Username: user.Username, Type: LogTypeTopup, Quota: redemption.Quota,
			CreatedAt: redemption.RedeemedTime, SourceIp: ip, Content: fmt.Sprintf("兑换码 #%d 充值 %s", redemption.Id, common.LogQuota(redemption.Quota))}
		if err := tx.Create(&log).Error; err != nil {
			return err
		}
		return tx.Model(redemption).Update("redeemed_log_id", log.Id).Error
	})
	if err != nil {
		return 0, errors.New("兑换失败，" + err.Error())
	}

	// Try to upgrade user group based on cumulative recharge amount
	err = CheckAndUpgradeUserGroup(userId, 0) // 余额已包含本次充值，不能重复累计。
	if err != nil {
		logger.SysError("failed to check and upgrade user group: " + err.Error())
	}

	if err := CacheUpdateUserQuota(userId); err != nil {
		logger.SysError("更新兑换余额缓存失败: " + err.Error())
	}
	return redemption.Quota, nil
}

func (redemption *Redemption) Insert() error {
	if err := validateRedemptionQuota(redemption.Quota); err != nil {
		return err
	}
	return DB.Create(redemption).Error
}

func (redemption *Redemption) Update(statusOnly bool) error {
	fields := []string{"name", "quota"}
	if statusOnly {
		if redemption.Status != config.RedemptionCodeStatusEnabled && redemption.Status != config.RedemptionCodeStatusDisabled {
			return errors.New("仅允许启用或停用未使用的兑换码")
		}
		fields = []string{"status"}
	}
	if !statusOnly || redemption.Status == config.RedemptionCodeStatusEnabled {
		if err := validateRedemptionQuota(redemption.Quota); err != nil {
			return err
		}
	}
	result := DB.Model(redemption).Where("status IN ? AND redeemed_time = 0", []int{config.RedemptionCodeStatusEnabled, config.RedemptionCodeStatusDisabled}).Select(fields).Updates(redemption)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := DB.Model(&Redemption{}).Where("id = ? AND status IN ? AND redeemed_time = 0", redemption.Id, []int{config.RedemptionCodeStatusEnabled, config.RedemptionCodeStatusDisabled}).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return errors.New("兑换码已使用或不存在，不能修改")
		}
	}
	return nil
}

func (redemption *Redemption) Delete() error {
	result := DB.Where("status IN ? AND redeemed_time = 0", []int{config.RedemptionCodeStatusEnabled, config.RedemptionCodeStatusDisabled}).Delete(redemption)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("已使用的兑换码须保留用于账务查询，不能删除")
	}
	return nil
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

type RedemptionStatistics struct {
	Count  int64 `json:"count"`
	Quota  int64 `json:"quota"`
	Status int   `json:"status"`
}

func GetStatisticsRedemption() (redemptionStatistics []*RedemptionStatistics, err error) {
	err = DB.Model(&Redemption{}).Select("status", "count(*) as count", "sum(quota) as quota").Where("status != ?", 2).Group("status").Scan(&redemptionStatistics).Error
	return redemptionStatistics, err
}

type RedemptionStatisticsGroup struct {
	Date      string `json:"date"`
	Quota     int64  `json:"quota"`
	UserCount int64  `json:"user_count"`
}

func GetStatisticsRedemptionByPeriod(startTimestamp, endTimestamp int64) (redemptionStatistics []*RedemptionStatisticsGroup, err error) {
	groupSelect := getTimestampGroupsSelect("redeemed_time", "day", "date")

	err = DB.Raw(`
		SELECT `+groupSelect+`,
		sum(quota) as quota,
		count(distinct NULLIF(redeemed_user_id, 0)) as user_count
		FROM redemptions
		WHERE status=3
		AND redeemed_time BETWEEN ? AND ?
		GROUP BY date
		ORDER BY date
	`, startTimestamp, endTimestamp).Scan(&redemptionStatistics).Error

	return redemptionStatistics, err
}
