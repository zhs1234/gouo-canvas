import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './loomic/globals.css'
import './style.css'
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false } } })
Object.assign(window, { EXCALIDRAW_ASSET_PATH: `${import.meta.env.BASE_URL}excalidraw-assets/` })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={client}><BrowserRouter basename="/studio/"><App /></BrowserRouter></QueryClientProvider></React.StrictMode>,
)
