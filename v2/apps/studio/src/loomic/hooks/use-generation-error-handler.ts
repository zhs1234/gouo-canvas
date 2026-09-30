import { useCallback } from 'react'
import { useToast } from '../components/toast'
export function useGenerationErrorHandler() {
  const { error } = useToast()
  const handleGenerationError = useCallback((value: unknown) => {
    error(value instanceof Error ? value.message : '生成请求失败')
    return false
  }, [error])
  return { handleGenerationError }
}
