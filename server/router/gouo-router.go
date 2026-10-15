package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// setGouoRouter 注册光构客户端和光构后台用的接口，都只接受登录会话
func setGouoRouter(apiRouter *gin.RouterGroup) {
	handle := func(group *gin.RouterGroup, method, path string, handler gin.HandlerFunc) {
		group.Handle(method, path, handler)
		middleware.DeclareGouoSessionRoute(method, group.BasePath()+path)
	}
	user := apiRouter.Group("/gouo")
	user.Use(middleware.UserAuth(), middleware.DisableCache())
	handle(user, "GET", "/token", controller.GetGouoPlaygroundToken)
	handle(user, "GET", "/models", controller.GetGouoModels)
	handle(user, "GET", "/agent/models", controller.GetGouoAgentModels)
	handle(user, "GET", "/image-results", controller.GetGouoImageResult)
	handle(user, "GET", "/storage", controller.GetGouoStorage)
	for _, path := range []string{"/canvases", "/conversations"} {
		handle(user, "GET", path, controller.ListGouoDocuments)
		handle(user, "GET", path+"/:id", controller.GetGouoDocument)
		handle(user, "PUT", path+"/:id", controller.PutGouoDocument)
		handle(user, "POST", path+"/:id/hide", controller.HideGouoDocument)
		handle(user, "POST", path+"/:id/restore", controller.RestoreGouoDocument)
	}
	handle(user, "POST", "/assets", controller.UploadGouoAsset)
	handle(user, "GET", "/assets/:id/content", controller.GetGouoAssetContent)
	handle(user, "PUT", "/tasks/:clientTaskId", controller.PutGouoTask)
	handle(user, "PATCH", "/tasks/:clientTaskId/meta", controller.PatchGouoTaskMeta)
	handle(user, "GET", "/tasks", controller.ListGouoTasks)
	handle(user, "GET", "/tasks/:id", controller.GetGouoTask)
	handle(user, "POST", "/tasks/:id/hide", controller.HideGouoTask)
	handle(user, "POST", "/tasks/:id/restore", controller.RestoreGouoTask)
	handle(user, "GET", "/collections", controller.ListGouoCollections)
	handle(user, "PUT", "/collections/:id", controller.PutGouoCollection)
	handle(user, "POST", "/collections/:id/hide", controller.HideGouoCollection)
	handle(user, "POST", "/collections/:id/restore", controller.RestoreGouoCollection)
	handle(user, "PUT", "/collections/:id/tasks/:taskId", controller.AddGouoFavoriteItem)
	handle(user, "DELETE", "/collections/:id/tasks/:taskId", controller.RemoveGouoFavoriteItem)

	admin := apiRouter.Group("/gouo/admin")
	admin.Use(middleware.AdminAuth(), middleware.DisableCache())
	handle(admin, "GET", "/settings", controller.GetGouoAdminSettings)
	handle(admin, "PUT", "/settings", controller.UpdateGouoAdminSettings)
	handle(admin, "GET", "/models", controller.ListGouoAdminModels)
	handle(admin, "PUT", "/models", controller.UpdateGouoAdminModel)
	handle(admin, "GET", "/agent-models", controller.ListGouoAdminAgentModels)
	handle(admin, "PUT", "/agent-models", controller.UpdateGouoAdminAgentModel)
	handle(admin, "GET", "/storage", controller.GetGouoAdminStorage)
	handle(admin, "GET", "/storage/users", controller.ListGouoAdminStorageUsers)
	handle(admin, "GET", "/storage/users/:id/tasks", controller.ListGouoAdminUserTasks)
	handle(admin, "GET", "/storage/users/:id/assets/:assetId/content", controller.GetGouoAdminUserAssetContent)
	handle(admin, "PUT", "/storage/users/:id/quota", controller.UpdateGouoAdminStorageQuota)
	handle(admin, "GET", "/image-charges", controller.ListGouoAdminImageCharges)
}
