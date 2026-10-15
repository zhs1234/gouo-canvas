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
import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'

/**
 * Gouo admin page sections; content is rendered directly in the page component
 */
const GOUO_SECTIONS = [
  { id: 'settings', titleKey: 'Gouo settings', build: () => null },
  { id: 'storage', titleKey: 'Cloud storage', build: () => null },
  { id: 'billing', titleKey: 'Image billing', build: () => null },
] as const

export type GouoSectionId = (typeof GOUO_SECTIONS)[number]['id']

const gouoRegistry = createSectionRegistry<
  GouoSectionId,
  Record<string, never>,
  []
>({
  sections: GOUO_SECTIONS,
  defaultSection: 'settings',
  basePath: '/gouo',
  urlStyle: 'path',
})

export const GOUO_SECTION_IDS = gouoRegistry.sectionIds
export const GOUO_DEFAULT_SECTION = gouoRegistry.defaultSection

export function getGouoSectionTitleKey(section: GouoSectionId): string {
  return GOUO_SECTIONS.find((item) => item.id === section)?.titleKey ?? ''
}
