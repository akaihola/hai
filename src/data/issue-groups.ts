import { STATUSES, statusForStage, type SourceState, type BackendCapabilities, type Issue, type IssueStatus } from '../domain'

export interface IssueGroup { id: string; label: string; status: IssueStatus; sourceState: string; accepted?: boolean }
export function stateLabel(state: SourceState, capabilities: BackendCapabilities): string {
  return capabilities.persistence === 'browser' ? STATUSES.find(status => status.id === state.id)?.label ?? state.id : state.id
}
export function issueGroups(capabilities: BackendCapabilities): IssueGroup[] {
  return capabilities.sourceStates.flatMap(state => {
    const group = { id: state.id, label: stateLabel(state, capabilities), status: statusForStage(state.stage), sourceState: state.id }
    return state.stage === 'done' && capabilities.fields?.acceptance && capabilities.workspaceScope !== 'all'
      ? [{ ...group, id: 'Completed', label: 'Completed', accepted: false }, { ...group, id: 'Accepted', label: 'Accepted', accepted: true }]
      : [group]
  })
}
export function issueGroupId(issue: Issue, groups: IssueGroup[]): string | undefined {
  return groups.find(group => group.sourceState === (issue.workspaceStage ?? issue.sourceState) && (group.accepted === undefined || group.accepted === !!issue.accepted))?.id
}
