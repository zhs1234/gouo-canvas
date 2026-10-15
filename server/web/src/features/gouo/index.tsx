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
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'

import { BillingSection } from './components/billing-section'
import { GouoSettingsSection } from './components/settings-section'
import { StorageSection } from './components/storage-section'
import {
  GOUO_DEFAULT_SECTION,
  GOUO_SECTION_IDS,
  getGouoSectionTitleKey,
  type GouoSectionId,
} from './section-registry'

const route = getRouteApi('/_authenticated/gouo/$section')

const SECTION_CONTENT: Record<GouoSectionId, () => React.ReactNode> = {
  settings: () => <GouoSettingsSection />,
  storage: () => <StorageSection />,
  billing: () => <BillingSection />,
}

export function GouoAdmin() {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/gouo/$section' })
  const params = route.useParams()
  const activeSection = (GOUO_SECTION_IDS as readonly string[]).includes(
    params.section
  )
    ? (params.section as GouoSectionId)
    : GOUO_DEFAULT_SECTION
  // 设置分区的保存按钮放在页头操作区，沿用系统设置页的做法
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({ to: '/gouo/$section', params: { section } })
    },
    [navigate]
  )

  return (
    <SettingsPageProvider
      actionsContainer={actionsContainer}
      suppressSectionHeader={false}
    >
      <SectionPageLayout fixedContent={activeSection !== 'settings'}>
        <SectionPageLayout.Title>
          {t(getGouoSectionTitleKey(activeSection))}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <div
            ref={setActionsContainer}
            className='flex flex-wrap items-center justify-end gap-2'
          />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-4'>
            <Tabs value={activeSection} onValueChange={handleSectionChange}>
              <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
                {GOUO_SECTION_IDS.map((section) => (
                  <TabsTrigger key={section} value={section}>
                    {t(getGouoSectionTitleKey(section))}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className='min-h-0 flex-1'>
              {SECTION_CONTENT[activeSection]()}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    </SettingsPageProvider>
  )
}
