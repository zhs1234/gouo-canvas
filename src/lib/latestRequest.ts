// 多个筛选/刷新请求并发时，只有最后一次可以提交结果、错误和加载状态。
export function createLatestRequest() {
  let revision = 0
  return {
    invalidate: () => { revision += 1 },
    async run<T>(request: () => Promise<T>, success: (value: T) => void, failure: (error: unknown) => void, finish: () => void) {
      const current = ++revision
      try {
        const value = await request()
        if (current === revision) success(value)
      } catch (err) {
        if (current === revision) failure(err)
      } finally {
        if (current === revision) finish()
      }
    },
  }
}
