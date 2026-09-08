import { followChoices } from '../follow.ts'
import type { Simulation } from '../replay/simulation.ts'

export function refreshFollowPicker(residents: Simulation['residents'], sleepers: ReadonlySet<number>, showSleepers: boolean,
  last: string, isDrawn: (resident: Simulation['residents'][number]) => boolean, selected: number | null = null): string {
  const search = document.querySelector<HTMLInputElement>('#follow-search')?.value ?? ''
  const choices = followChoices(Object.values(residents).map(resident => isDrawn(resident) ? resident : { ...resident, visible: false }),
    sleepers, showSleepers, search)
  const serialized = JSON.stringify([choices, selected])
  if (serialized === last) return last
  const picker = document.querySelector<HTMLSelectElement>('#follow-picker')
  if (!picker) return serialized
  const prompt = new Option('Follow a resident…', '', true, true); prompt.disabled = true
  picker.replaceChildren(prompt, ...choices.map(choice => new Option(choice.name, String(choice.id))))
  if (selected !== null) {
    if (!choices.some(choice => choice.id === selected) && residents[selected]) picker.add(new Option(residents[selected]!.handle, String(selected)))
    picker.value = String(selected)
  }
  return serialized
}
