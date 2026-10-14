package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// setGouoRouter 注册光构客户端和光构后台用的接口
func setGouoRouter(apiRouter *gin.RouterGroup) {
	gouoRoute := apiRouter.Group("/gouo")
	gouoRoute.Use(middleware.UserAuth(), middleware.DisableCache())
	{
		gouoRoute.GET("/token", controller.GetGouoPlaygroundToken)
		gouoRoute.GET("/models", controller.GetGouoModels)
		gouoRoute.GET("/image-results", controller.GetGouoImageResult)
	}
	gouoAdminRoute := apiRouter.Group("/gouo/admin")
	gouoAdminRoute.Use(middleware.AdminAuth(), middleware.DisableCache())
	{
		gouoAdminRoute.GET("/settings", controller.GetGouoAdminSettings)
		gouoAdminRoute.PUT("/settings", controller.UpdateGouoAdminSettings)
		gouoAdminRoute.GET("/models", controller.ListGouoAdminModels)
		gouoAdminRoute.PUT("/models", controller.UpdateGouoAdminModel)
	}
}
