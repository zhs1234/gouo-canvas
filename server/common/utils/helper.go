package utils

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/bwmarrin/snowflake"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/spf13/viper"
)

var node *snowflake.Node

func init() {
	var err error
	node, err = snowflake.NewNode(1)
	if err != nil {
		log.Fatalf("snowflake.NewNode failed: %v", err)
	}
}

func Interface2String(inter interface{}) string {
	switch inter := inter.(type) {
	case string:
		return inter
	case int:
		return fmt.Sprintf("%d", inter)
	case float64:
		return fmt.Sprintf("%f", inter)
	}
	return "Not Implemented"
}

func GetUUID() string {
	code := uuid.New().String()
	code = strings.Replace(code, "-", "", -1)
	return code
}

const keyChars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func GenerateKey() string {
	key := make([]byte, 48)
	for i := 0; i < 16; i++ {
		key[i] = keyChars[rand.Intn(len(keyChars))]
	}
	uuid_ := GetUUID()
	for i := 0; i < 32; i++ {
		c := uuid_[i]
		if i%2 == 0 && c >= 'a' && c <= 'z' {
			c = c - 'a' + 'A'
		}
		key[i+16] = c
	}
	return string(key)
}

func GetRandomString(length int) string {
	key := make([]byte, length)
	for i := 0; i < length; i++ {
		key[i] = keyChars[rand.Intn(len(keyChars))]
	}
	return string(key)
}

func GetRandomInt(length int) int {
	return rand.Intn(int(math.Pow10(length)))
}

func GetTimestamp() int64 {
	return time.Now().Unix()
}

func GetTimeString() string {
	now := time.Now()
	return fmt.Sprintf("%s%d", now.Format("20060102150405"), now.UnixNano()%1e9)
}

func GetOrDefault[T any](env string, defaultValue T) T {
	if viper.IsSet(env) {
		value := viper.Get(env)
		if v, ok := value.(T); ok {
			return v
		}
	}
	// 处理常见的类型转换场景
	switch any(defaultValue).(type) {
	case int:
		if intVal := viper.GetInt(env); intVal != 0 || viper.GetString(env) == "0" {
			if result, ok := any(intVal).(T); ok {
				return result
			}
		}
	case int64:
		if int64Val := viper.GetInt64(env); int64Val != 0 || viper.GetString(env) == "0" {
			if result, ok := any(int64Val).(T); ok {
				return result
			}
		}
	case float64:
		if floatVal := viper.GetFloat64(env); floatVal != 0 || viper.GetString(env) == "0" {
			if result, ok := any(floatVal).(T); ok {
				return result
			}
		}
	case string:
		if strVal := viper.GetString(env); strVal != "" || viper.IsSet(env) {
			if result, ok := any(strVal).(T); ok {
				return result
			}
		}
	case bool:
		if boolVal := viper.GetBool(env); boolVal || viper.GetString(env) == "false" {
			if result, ok := any(boolVal).(T); ok {
				return result
			}
		}
	}

	return defaultValue
}

func MessageWithRequestId(message string, id string) string {
	return fmt.Sprintf("%s (request id: %s)", message, id)
}

func String2Int(str string) int {
	num, err := strconv.Atoi(str)
	if err != nil {
		return 0
	}
	return num
}

func String2Int64(str string) int64 {
	num, err := strconv.ParseInt(str, 10, 64)
	if err != nil {
		return 0
	}
	return num
}

func IsFileExist(path string) bool {
	_, err := os.Stat(path)
	return err == nil || os.IsExist(err)
}

func ContainsString(s string, keywords []string) bool {
	for _, keyword := range keywords {
		if strings.Contains(s, keyword) {
			return true
		}
	}
	return false
}

func Filter[T any](arr []T, f func(T) bool) []T {
	var res []T
	for _, v := range arr {
		if f(v) {
			res = append(res, v)
		}
	}
	return res
}

func GetModelsWithMatch(modelList *[]string, modelName string) string {
	for _, model := range *modelList {
		if strings.HasPrefix(modelName, strings.TrimRight(model, "*")) {
			return model
		}
	}
	return ""
}

func EscapeMarkdownText(text string) string {
	chars := []string{"_", "*", "[", "]", "(", ")", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!", "`"}
	for _, char := range chars {
		text = strings.ReplaceAll(text, char, "\\"+char)
	}
	return text
}

func UnmarshalString[T interface{}](data string) (form T, err error) {
	err = json.Unmarshal([]byte(data), &form)
	return form, err
}

func Marshal[T interface{}](data T) string {
	res, err := json.Marshal(data)
	if err != nil {
		return ""
	}
	return string(res)
}

func GenerateTradeNo() string {
	id := node.Generate()

	return id.String()
}

func Decimal(value float64, decimalPlace int) float64 {
	format := fmt.Sprintf("%%.%df", decimalPlace)
	value, _ = strconv.ParseFloat(fmt.Sprintf(format, value), 64)
	return value
}

func NumClamp(value, minVal, maxVal float64) float64 {
	return math.Max(minVal, math.Min(maxVal, value))
}

func GetGinValue[T any](c *gin.Context, key string) (T, bool) {
	value, exists := c.Get(key)
	if !exists {
		var zeroValue T
		return zeroValue, false
	}
	if v, ok := value.(T); ok {
		return v, true
	}

	var zeroValue T
	return zeroValue, false
}

func GetPointer[T any](val T) *T {
	return &val
}

func GetLocalTimezone() string {
	if tz := os.Getenv("TZ"); tz != "" {
		return tz
	}

	return "Asia/Shanghai"
}

// IsIpInCidr 判断IP是否在CIDR范围内
func IsIpInCidr(ip string, cidr string) bool {
	_, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return false
	}
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return false
	}
	return ipNet.Contains(parsedIP)
}
