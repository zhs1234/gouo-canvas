/*
Copyright (C) 2026 Gouo Canvas contributors

This file is part of Gouo Canvas, a modified version of New API.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { AgentModelsSection } from '../components/agent-models-section'
import { ImageModelDrawer } from '../components/image-model-drawer'
import type { GouoAgentModel, GouoImageModel } from '../types'

test('expression models show expression pricing in the table and edit drawer', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const model: GouoAgentModel = {
    model: 'expression-agent',
    billing_mode: 'tiered_expr',
    listed: true,
    vision: true,
    sort: 0,
    name: '',
    description: '',
    max_tokens: 0,
    updated_at: 0,
    input_price_cny: 0,
    output_price_cny: 0,
    groups: ['default'],
    reason: '',
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { models: [model] } },
  })
  const root = createRootRoute({ component: Outlet })
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Outlet,
  })
  const section = createRoute({
    getParentRoute: () => authenticated,
    path: 'gouo/$section',
    component: AgentModelsSection,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([section])]),
    history: createMemoryHistory({ initialEntries: ['/gouo/agent-models'] }),
  })
  await router.load()
  try {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    const row = await screen.findByRole('row', { name: /expression-agent/ })
    expect(within(row).getByText('Visible')).toBeVisible()
    expect(within(row).getByText('Expression billing')).toBeVisible()
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Expression billing')).toBeVisible()
    expect(
      within(drawer).queryByText(
        'Billed by tokens with the New API model price and the user group ratio.'
      )
    ).not.toBeInTheDocument()
  } finally {
    cleanup()
    client.clear()
  }
})

test('image model editing links to native pricing and omits the old per-image price field', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const client = new QueryClient()
  const model: GouoImageModel = {
    model: 'native-image',
    enabled: true,
    price_cny: 99,
    reference: true,
    mask: false,
    max_outputs: 1,
    sizes: ['1K'],
    qualities: [],
    max_inputs: 0,
    sort: 0,
    name: '',
    description: '',
    updated_at: 0,
    groups: ['default'],
  }
  const root = createRootRoute({
    component: () => <ImageModelDrawer row={model} onOpenChange={() => {}} />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  try {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    const drawer = await screen.findByRole('dialog')
    expect(
      within(drawer).getByRole('link', { name: 'Edit model pricing' })
    ).toHaveAttribute('href', '/system-settings/billing/model-pricing')
    expect(
      within(drawer).queryByLabelText('Price per request (CNY)')
    ).not.toBeInTheDocument()
  } finally {
    cleanup()
    client.clear()
  }
})
