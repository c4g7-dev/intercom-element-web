/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * InterCom's sound cues: joining and leaving a call, and the user's own microphone and hearing
 * going off and on. The built-in sounds are InterCom's own (apps/desktop/intercom/gen-sounds.py
 * makes them from sines); a file of the user's in the profile's `sounds` directory is played
 * instead where there is one (desktop app only, see apps/desktop/src/intercom-sounds.ts).
 */

/** The cues there are; a custom file is named after its cue. */
export const SOUND_CUES = ["join", "leave", "mute", "unmute", "deafen", "undeafen"] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

/** One of the user's own sounds, as the desktop app hands it over. */
export interface CustomSound {
    name: string;
    type: string;
    /** The file, in base64 */
    data: string;
}

export type CustomSounds = Partial<Record<SoundCue, CustomSound>>;

/** The largest custom sound that is taken: 2 MB, in base64. */
const MAX_CUSTOM_BASE64_LENGTH = Math.ceil((2 * 1024 * 1024) / 3) * 4;

/** How loud a cue is played, of what its file has. */
const CUE_GAIN = 0.8;

/**
 * Reads what the desktop app said the user's sounds are. Only the cues there are, with a name
 * and something in them; anything else is left out.
 */
export function parseCustomSounds(raw: unknown): CustomSounds {
    const sounds: CustomSounds = {};
    if (typeof raw !== "object" || raw === null) return sounds;
    for (const cue of SOUND_CUES) {
        const entry = (raw as Record<string, unknown>)[cue] as Partial<CustomSound> | undefined;
        if (typeof entry !== "object" || entry === null) continue;
        if (typeof entry.data !== "string" || !entry.data || entry.data.length > MAX_CUSTOM_BASE64_LENGTH) continue;
        sounds[cue] = {
            name: typeof entry.name === "string" ? entry.name : cue,
            type: typeof entry.type === "string" ? entry.type : "audio/ogg",
            data: entry.data,
        };
    }
    return sounds;
}

let customSounds: Promise<CustomSounds> | undefined;

/**
 * The user's own sounds. Asked for once: a file that is put there later is played from the next
 * start of the app. Without the desktop app there are none.
 */
export async function getCustomSounds(): Promise<CustomSounds> {
    customSounds ??= (async (): Promise<CustomSounds> => {
        try {
            return parseCustomSounds(await window.electron?.intercomSounds?.list());
        } catch {
            return {};
        }
    })();
    return customSounds;
}

function base64ToArrayBuffer(data: string): ArrayBuffer {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

let context: AudioContext | undefined;
const buffers = new Map<SoundCue, Promise<AudioBuffer | undefined>>();

function getContext(): AudioContext | undefined {
    if (typeof AudioContext === "undefined") return undefined;
    if (context === undefined || context.state === "closed") {
        context = new AudioContext({ latencyHint: "interactive" });
        buffers.clear();
    }
    if (context.state === "suspended") context.resume().catch(() => undefined);
    return context;
}

async function loadBuffer(audio: AudioContext, cue: SoundCue): Promise<AudioBuffer | undefined> {
    const custom = (await getCustomSounds())[cue];
    if (custom) {
        try {
            return await audio.decodeAudioData(base64ToArrayBuffer(custom.data));
        } catch {
            // Not a sound the browser can play: the built-in one then
        }
    }
    try {
        const response = await fetch(`media/intercom/${cue}.ogg`);
        if (!response.ok) return undefined;
        return await audio.decodeAudioData(await response.arrayBuffer());
    } catch {
        return undefined;
    }
}

/** Two short tones, rising or falling: what is played where no sound file could be. */
function playTones(audio: AudioContext, rising: boolean): void {
    const tones = rising ? [520, 780] : [780, 520];
    const start = audio.currentTime + 0.01;
    tones.forEach((frequency, i) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const at = start + i * 0.09;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.09);
    });
}

/** Whether a cue is of something coming on (rising) rather than going off. */
export function isRisingCue(cue: SoundCue): boolean {
    return cue === "join" || cue === "unmute" || cue === "undeafen";
}

/**
 * Plays a cue: the user's own file for it, else the built-in sound, else two tones. It is played
 * by the app and not by a call, so it is heard whether or not the user is deafened in the call,
 * and after the call's view is gone. Never throws.
 */
export function playSoundCue(cue: SoundCue): void {
    try {
        const audio = getContext();
        if (!audio) return;
        let buffer = buffers.get(cue);
        if (!buffer) {
            buffer = loadBuffer(audio, cue);
            buffers.set(cue, buffer);
        }
        void buffer.then((decoded) => {
            try {
                if (audio.state === "closed") return;
                if (!decoded) {
                    playTones(audio, isRisingCue(cue));
                    return;
                }
                const source = audio.createBufferSource();
                const gain = audio.createGain();
                source.buffer = decoded;
                gain.gain.value = CUE_GAIN;
                source.connect(gain);
                gain.connect(audio.destination);
                source.start();
            } catch {
                // A sound that cannot be played is not worth more than that
            }
        });
    } catch {
        // A sound that cannot be played is not worth more than that
    }
}

/** For tests: forgets what was loaded. */
export function resetSoundCuesForTest(): void {
    customSounds = undefined;
    context = undefined;
    buffers.clear();
}
