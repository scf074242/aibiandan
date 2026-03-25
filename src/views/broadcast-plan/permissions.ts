/**
 * 播出单权限管理
 */

export interface BroadcastSection {
  id: string
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
  sections: BroadcastSection[]
  recorded?: boolean
  live?: boolean
  ad?: boolean
}

const broadcastPermissions: Record<string, BroadcastPermission> = {
  admin: {
    canEdit: true,
    canDelete: true,
    canView: true,
    canOrchestrate: true,
    sections: [
      { id: 'section-1', name: '全天时段', canEdit: true, canDelete: true, canView: true },
    ],
  },
  editor: {
    canEdit: true,
    canDelete: false,
    canView: true,
    canOrchestrate: true,
    sections: [
      { id: 'section-1', name: '白天时段', canEdit: true, canDelete: false, canView: true },
    ],
  },
  viewer: {
    canEdit: false,
    canDelete: false,
    canView: true,
    canOrchestrate: false,
    sections: [],
  },
}

export function getBroadcastPlanPermission(role?: string): BroadcastPermission {
  const userRole = role || 'editor'
  return broadcastPermissions[userRole] || broadcastPermissions.viewer
}

export function canEditSection(sectionId: string, permission: BroadcastPermission): boolean {
  if (permission.canEdit) {
    return true
  }
  const section = permission.sections.find((s) => s.id === sectionId)
  return section?.canEdit || false
}

export function canDeleteSection(sectionId: string, permission: BroadcastPermission): boolean {
  if (permission.canDelete) {
    return true
  }
  const section = permission.sections.find((s) => s.id === sectionId)
  return section?.canDelete || false
}
