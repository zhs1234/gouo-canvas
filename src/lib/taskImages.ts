import type { TaskRecord } from '../types'

// 任务引用的全部图片：输入、遮罩、输出、透明处理前的原图和流式中间图
export function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskTargetImageId) target.add(task.maskTargetImageId)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.transparentOriginalImages || []) {
    if (id) target.add(id)
  }
  for (const id of task.streamPartialImageIds || []) target.add(id)
}
