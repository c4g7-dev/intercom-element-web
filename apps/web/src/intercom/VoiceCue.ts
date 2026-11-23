/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

let toneContext: AudioContext | undefined;

/** How loud the cue is, of full scale. */
const CUE_GAIN = 0.12;

/**
 * The cue of the user's own microphone or hearing going on or off: two short tones, rising for
 * on and falling for off. It is played by the app and not by the call, so that it is heard once
 * per change wherever the change came from, also outside a call and while the window is not
 * focused. Nothing is played for anybody else's state.
 */
export function playVoiceCue(on: boolean): void {
    try {
        if (typeof AudioContext === "undefined") return;
        if (toneContext === undefined || toneContext.state === "closed") toneContext = new AudioContext();
        const context = toneContext;
        if (context.state === "suspended") context.resume().catch(() => undefined);
        const tones = on ? [520, 780] : [780, 520];
        const start = context.currentTime + 0.01;
        tones.forEach((frequency, i) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const at = start + i * 0.09;
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(CUE_GAIN, at + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(at);
            oscillator.stop(at + 0.09);
        });
    } catch {
        // A sound that cannot be played is not worth more than that
    }
}
