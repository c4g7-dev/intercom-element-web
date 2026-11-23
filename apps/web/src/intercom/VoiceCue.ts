/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { playSoundCue, type SoundCue } from "./Sounds";

/**
 * The cue of the user's own microphone or hearing going on or off: a short chime, rising for
 * on and falling for off, one for the microphone and a lower one for the hearing. It is played
 * by the app and not by the call, so that it is heard once per change wherever the change came
 * from, also outside a call and while the window is not focused. Nothing is played for anybody
 * else's state.
 * @param on - whether something came on
 * @param cue - which sound; the microphone's where it is not said
 */
export function playVoiceCue(on: boolean, cue: SoundCue = on ? "unmute" : "mute"): void {
    playSoundCue(cue);
}
