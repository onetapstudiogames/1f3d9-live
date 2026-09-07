import { followChoices } from '../follow.ts'
import type { Simulation } from '../replay/simulation.ts'

export function refreshFollowPicker(residents: Simulation['residents'], sleepers: ReadonlySet<number>, showSleepers: boolean,
  last: string, isDrawn: (resident: Simulation['residents'][number]) => boolean): string {
  const search = document.querySelector<HTMLInputElement>('#follow-search')?.value ?? ''
  const choices = followChoices(Object.values(residents).map(resident => isDrawn(resident) ? resident : { ...resident, visible: false }),
    sleepers, showSleepers, search)
  const serialized = JSON.stringify(choices)
  if (serialized === last) return last
  const picker = document.querySelector<HTMLSelectElement>('#follow-picker')
  if (!picker) return serialized
  const prompt = new Option('Choose a resident…', '', true, true); prompt.disabled = true
  picker.replaceChildren(prompt, ...choices.map(choice => new Option(choice.name, String(choice.id))))
  return serialized
}
