import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './loomic/globals.css'
import './style.css'
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false } } })
// Model intent lives for this SPA session, including a long canvas visit.
// Identity changes explicitly clear it along with the other owner's queries.
client.setQueryDefaults(['chat-lab-selection'], { gcTime: Infinity })
const router = createBrowserRouter([{ path: '*', element: <App /> }], { basename: '/studio' })
Object.assign(window, { EXCALIDRAW_ASSET_PATH: `${import.meta.env.BASE_URL}excalidraw-assets/` })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></React.StrictMode>,
)
