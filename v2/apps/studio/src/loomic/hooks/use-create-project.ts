export const INITIAL_AGENT_MODEL_KEY = 'gouo:initial-model'
export const INITIAL_ATTACHMENTS_KEY = 'gouo:initial-attachments'
export const INITIAL_IMAGE_GENERATION_PREFERENCE_KEY = 'gouo:initial-image-preference'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { changeDraft } from '../lib/local-drafts'
import { useToast } from '../components/toast'
export function useCreateProject() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  async function create() {
    if (creating) return
    setCreating(true)
    try {
      const id = crypto.randomUUID()
      await changeDraft(`local:${user?.id ?? 'guest'}`, id, draft => { draft.canvas.name = '未命名创作' })
      navigate(`/?id=${id}`)
    } catch { toast.error('无法新建本地画布') }
    finally { setCreating(false) }
  }
  return { create, creating }
}
