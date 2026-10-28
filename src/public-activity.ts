import type { PublicActivity, Resident } from './city/types.ts'

export function publicActivity(value: unknown): PublicActivity | undefined {
  return value === 'active now' || value === 'today' || value === 'this week' || value === 'longer'
    ? value : undefined
}

export function withoutResidentActivity(residents: readonly Resident[]): readonly Resident[] {
  return residents.map(({ last_active: _activity, ...resident }) => resident)
}
