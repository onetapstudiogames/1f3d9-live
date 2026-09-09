export function fixtureMode(search = window.location.search): boolean {
  const params = new URLSearchParams(search)
  return params.has('census')
}

export function recordSpeechFixture(speech: { residentId: number; text: string; shape: string; showing: string } | null,
  fixtureMode: boolean, handshakeCount: number): void {
  document.body.dataset['liveBubbleText'] = speech?.text ?? ''
  document.body.dataset['liveBubbleShape'] = speech?.shape ?? ''
  document.body.dataset['liveBubbleResident'] = speech ? String(speech.residentId) : ''
  if (fixtureMode) document.body.dataset['liveShowing'] = speech?.showing ?? ''
  if (fixtureMode) document.body.dataset['liveShowingResident'] = speech?.showing ? String(speech.residentId) : ''
  if (fixtureMode) document.body.dataset['liveHandshakes'] = String(handshakeCount)
}
