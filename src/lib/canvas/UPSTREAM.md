# Infinite Canvas 源码来源

- 项目：https://github.com/basketikun/infinite-canvas
- 固定提交：`dab19adc0847e32e39b7fc8ff90cb392561fb826`
- 许可：MIT（完整原文见同目录 `LICENSE.infinite-canvas`）
- 复用：无限视口、网格、节点及尺寸控制、连线、小地图、工具栏、顶部栏、缩放控件、选择工具栏、创建菜单、裁剪窗口、节点几何计算、主题和中文文案。
- 适配：路径及代码格式、Tailwind 3、图片 IndexedDB、项目持久化、光构任务提交和平台 Agent。资源侧栏保留原版布局并连接光构素材及灵感。视频、音频和远程插件入口不在首版提供。
- 原版画布页面中的交互流程拆分到 `canvasEditor.tsx` 和独立 `canvasStore.ts`，画布未挂载时 Agent 仍可修改文档。

升级时比较固定提交及本地适配点，不能覆盖光构的账号隔离、任务校验、计费及图片引用保护逻辑。
