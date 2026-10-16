import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import SearchBar from './SearchBar'
import TaskGrid from './TaskGrid'
import { FavoriteCollectionsView } from './favorites/FavoriteCollectionsView'
import { useFavoriteCollectionTitle } from './favorites/useFavoriteCollectionTitle'
import SelectionActions from './input/selectionActions'

// 作品页和收藏页不在首屏，单独成块按需加载
export function WorksWorkspace() {
  const navigate = useNavigate()
  return <main className="library-page" aria-labelledby="works-heading">
    <header className="library-page-heading"><h1 id="works-heading">我的作品</h1><p>查看生成进度，管理作品，继续创作。</p></header>
    <section data-drag-select-surface aria-label="作品列表">
      <SearchBar onToggleFavorites={() => navigate('/favorites')} />
      <TaskGrid />
    </section>
    <SelectionActions inline />
  </main>
}

export function FavoritesWorkspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const collection = useStore((s) => s.activeFavoriteCollectionId)
  const title = useFavoriteCollectionTitle()
  useEffect(() => {
    const state = useStore.getState()
    state.setActiveFavoriteCollectionId(null)
    state.setSearchQuery('')
    state.setFilterStatus('all')
  }, [location.key])
  return <main className="library-page" aria-labelledby="favorites-heading">
    <header className="library-page-heading"><h1 id="favorites-heading">{title || '收藏'}</h1><p>{collection ? '收藏的作品，随时继续创作。' : '把喜欢的作品整理在一起，留住每一次灵感。'}</p></header>
    <section data-drag-select-surface aria-label="收藏作品">
      <SearchBar onToggleFavorites={() => navigate('/works')} />
      {collection ? <TaskGrid /> : <FavoriteCollectionsView />}
    </section>
    <SelectionActions inline />
  </main>
}
