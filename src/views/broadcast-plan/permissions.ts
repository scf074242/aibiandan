export type BroadcastSection = 'recorded' | 'live' | 'ad'

export interface SectionPermission {
  id: BroadcastSection
  name: string
  canEdit: boolean
  canDelete: boolean
  canView: boolean
}

export interface BroadcastPermission {
  canEdit: boolean
  canDelete: boolean
  canView: boolean
  canOrchestrate: boolean
  sections: SectionPermission[]
  recorded: boolean
  live: boolean
  ad: boolean
}

const makeSections = (permission: Pick<BroadcastPermission, 'recorded' | 'live' | 'ad'>): SectionPermission[] => [
  { id: 'recorded', name: '录播', canEdit: permission.recorded, canDelete: permission.recorded, canView: true },
  { id: 'live', name: '直播', canEdit: permission.live, canDelete: permission.live, canView: true },
  { id: 'ad', name: '广告', canEdit: permission.ad, canDelete: permission.ad, canView: true },
]

const broadcastPermissions: Record<string, BroadcastPermission> = {
  admin: {
    canEdit: true,
    canDelete: true,
    canView: true,
    canOrchestrate: true,
    recorded: true,
    live: true,
    ad: true,
    sections: makeSections({ recorded: true, live: true, ad: true }),
  },
  editor: {
    canEdit: true,
    canDelete: false,
    canView: true,
    canOrchestrate: true,
    recorded: true,
    live: true,
    ad: true,
    sections: makeSections({ recorded: true, live: true, ad: true }),
  },
  viewer: {
    canEdit: false,
    canDelete: false,
    canView: true,
    canOrchestrate: false,
    recorded: false,
    live: false,
    ad: false,
    sections: makeSections({ recorded: false, live: false, ad: false }),
  },
}

export function getBroadcastPlanPermission(role = 'editor'): BroadcastPermission {
  return broadcastPermissions[role] ?? broadcastPermissions.viewer!
}

export function canEditSection(sectionId: BroadcastSection, permission: BroadcastPermission): boolean {
  return permission[sectionId] || permission.canEdit
}

export function canDeleteSection(sectionId: BroadcastSection, permission: BroadcastPermission): boolean {
  return permission[sectionId] && permission.canDelete
}
