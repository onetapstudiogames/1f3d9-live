import { cameraViewLabel, type CameraView } from '../view-label.ts'

export function updateViewControls(state: CameraView): void {
  const view = document.getElementById('view')
  if (view) view.textContent = cameraViewLabel(state)
  const following = state.followed !== undefined
  const followState = document.getElementById('follow-state')
  if (followState) followState.textContent = following ? `Following ${state.followed ?? 'resident'} ·` : ''
  const stop = document.querySelector<HTMLButtonElement>('#follow-stop')
  if (stop) stop.hidden = !following
}
