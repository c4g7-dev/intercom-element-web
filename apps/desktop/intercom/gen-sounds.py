#!/usr/bin/env python3
# Copyright 2026 The InterCom contributors
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
# Please see LICENSE files in the repository root for full details.
"""Makes InterCom's sound cues: short, soft chimes of two notes, worked out here from sines.

    gen-sounds.py [--out DIR] [--cues join,leave,ringtone,...] [--wav]

Nothing is sampled from anywhere: every file is the output of this script, which is why the
cues can be shipped under the project's own licence. The notes rise where something comes on
(join, unmute, undeafen) and fall where it goes off (leave, mute, deafen); join and leave are the
softer and rounder of them (CHIMES), as they are heard for everybody who comes and goes. Two more are loops,
played until a call is answered: "ringtone" (a call coming in) and "ringback" (a call going out).
The Android app takes its copies of all of them from the output directory, res/media/intercom.

Needs python 3 and ffmpeg with libvorbis (for .ogg); --wav writes the uncompressed files instead
and needs nothing. The same script makes the cues of the call (join, leave, ringback) in
InterCom's Element Call fork, src/sound/intercom_*.ogg.
"""
import argparse
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

RATE = 48000
PEAK = 0.25  # about -12 dBFS: a cue, not an alarm

# name: (notes in Hz, seconds between the notes' starts, seconds a note rings)
CUES = {
    # Mute and deafen come often (hotkeys): an octave lower than they were, and softer (SOFT)
    "unmute": ((329.63, 493.88), 0.08, 0.16),  # E4, B4
    "mute": ((493.88, 329.63), 0.08, 0.16),  # B4, E4
    "undeafen": ((261.63, 349.23), 0.10, 0.24),  # C4, F4
    "deafen": ((349.23, 261.63), 0.10, 0.24),  # F4, C4
}

# Cues played quieter, with a slower attack and less of the octave: (peak, attack in s, octave)
SOFT = {name: (0.15, 0.014, 0.06) for name in ("unmute", "mute", "undeafen", "deafen")}
DEFAULT_TONE = (PEAK, 0.006, 0.18)

# The two sounds of a call being set up, which are played over and over until it is answered:
# "ringtone" for a call coming in, "ringback" for one going out. Each file is one round of the
# loop, silent at both ends, so that it can be repeated without a gap or a click.
# name: (notes in Hz, seconds between the notes' starts, seconds a note rings, seconds the last
#        note rings, seconds a round takes, peak, attack in s)
LOOPS = {
    # G4, B4, D5, G5: a chord going up, then a rest. About -14 dBFS
    "ringtone": ((392.00, 493.88, 587.33, 783.99), 0.17, 0.50, 0.95, 2.4, 0.2, 0.018),
    # A4, C#5: two slow, soft notes, then a long rest. About -18 dBFS
    "ringback": ((440.00, 554.37), 0.42, 0.70, 0.90, 3.0, 0.126, 0.030),
}
LOOP_LEAD = 0.03  # silence before the first note

# Somebody coming into a call and going out of it: two soft notes a major third apart, the second
# beginning in the tail of the first, a third of a second in all. They are of the family of the
# loops above (rounded attack, the same low-pass) and not of the cues further up: the join rises,
# the leave is the same two notes falling, and quieter.
# name: (notes in Hz, seconds between the notes' starts, seconds the first note rings, seconds the
#        last note rings, peak, attack in s)
CHIMES = {
    "join": ((523.25, 659.26), 0.095, 0.20, 0.24, 0.178, 0.022),  # C5, E5. About -15 dBFS
    "leave": ((659.26, 523.25), 0.095, 0.20, 0.24, 0.126, 0.022),  # E5, C5. About -18 dBFS
}
CHIME_LEAD = 0.003  # silence at both ends, which the low-pass needs
CHIME_OCTAVE = 0.06  # how much of the octave above is in a note: very little
LOOP_CUTOFF = 3500.0  # nothing is left above about 4 kHz


def note(frequency, ring, attack_s=0.006, octave=0.18):
    """One note: a sine with a little of its octave, a short attack and a decay to silence."""
    count = int(RATE * ring)
    attack = int(RATE * attack_s)
    out = []
    for i in range(count):
        t = i / RATE
        envelope = min(1.0, i / attack) * math.exp(-t * 5.0 / ring)
        # The last 10 ms go to zero whatever the decay left, so that nothing clicks
        envelope *= min(1.0, (count - i) / (RATE * 0.01))
        sample = math.sin(2 * math.pi * frequency * t) + octave * math.sin(4 * math.pi * frequency * t)
        out.append(envelope * sample)
    return out


def render(name):
    notes, step, ring = CUES[name]
    peak, attack_s, octave = SOFT.get(name, DEFAULT_TONE)
    length = int(RATE * (step * (len(notes) - 1) + ring + 0.02))
    mix = [0.0] * length
    for index, frequency in enumerate(notes):
        start = int(RATE * step * index)
        for i, sample in enumerate(note(frequency, ring, attack_s, octave)):
            mix[start + i] += sample
    top = max(abs(sample) for sample in mix)
    return [sample / top * peak for sample in mix]


def warm_note(frequency, ring, attack_s):
    """One note of a loop: a sine with a little of the octave below and of the octave above, an
    attack and a release that are rounded (half a cosine), and a decay."""
    count = int(RATE * ring)
    attack = int(RATE * attack_s)
    release = int(RATE * 0.04)
    out = []
    for i in range(count):
        t = i / RATE
        envelope = math.exp(-t * 4.5 / ring)
        if i < attack:
            envelope *= 0.5 - 0.5 * math.cos(math.pi * i / attack)
        if count - i < release:
            envelope *= 0.5 - 0.5 * math.cos(math.pi * (count - i) / release)
        phase = 2 * math.pi * frequency * t
        sample = math.sin(phase) + 0.12 * math.sin(phase / 2) + 0.10 * math.sin(phase * 2)
        out.append(envelope * sample)
    return out


def soft_note(frequency, ring, attack_s):
    """One note of a chime: a sine with very little of its octave, an attack and a release that
    are rounded (half a cosine), and a decay."""
    count = int(RATE * ring)
    attack = int(RATE * attack_s)
    release = int(RATE * 0.04)
    out = []
    for i in range(count):
        t = i / RATE
        envelope = math.exp(-t * 4.0 / ring)
        if i < attack:
            envelope *= 0.5 - 0.5 * math.cos(math.pi * i / attack)
        if count - i < release:
            envelope *= 0.5 - 0.5 * math.cos(math.pi * (count - i) / release)
        phase = 2 * math.pi * frequency * t
        out.append(envelope * (math.sin(phase) + CHIME_OCTAVE * math.sin(phase * 2)))
    return out


def low_pass(samples, cutoff):
    """A windowed-sinc low-pass (Blackman, 127 taps): what little the envelopes put above the
    cutoff goes."""
    taps = 127
    middle = taps // 2
    kernel = []
    for i in range(taps):
        x = i - middle
        sinc = 2 * cutoff / RATE if x == 0 else math.sin(2 * math.pi * cutoff * x / RATE) / (math.pi * x)
        window = 0.42 - 0.5 * math.cos(2 * math.pi * i / (taps - 1)) + 0.08 * math.cos(4 * math.pi * i / (taps - 1))
        kernel.append(sinc * window)
    total = sum(kernel)
    kernel = [k / total for k in kernel]
    length = len(samples)
    out = [0.0] * length
    for i in range(length):
        low = max(0, i - middle)
        high = min(length, i + middle + 1)
        if not any(samples[low:high]):
            continue
        acc = 0.0
        for j in range(low, high):
            acc += samples[j] * kernel[j - i + middle]
        out[i] = acc
    return out


def render_loop(name):
    notes, step, ring, last_ring, length_s, peak, attack_s = LOOPS[name]
    mix = [0.0] * int(RATE * length_s)
    for index, frequency in enumerate(notes):
        start = int(RATE * (LOOP_LEAD + step * index))
        for i, sample in enumerate(warm_note(frequency, last_ring if index == len(notes) - 1 else ring, attack_s)):
            mix[start + i] += sample
    mix = low_pass(mix, LOOP_CUTOFF)
    top = max(abs(sample) for sample in mix)
    return [sample / top * peak for sample in mix]


def render_chime(name):
    notes, step, ring, last_ring, peak, attack_s = CHIMES[name]
    length_s = CHIME_LEAD + step * (len(notes) - 1) + last_ring + CHIME_LEAD
    mix = [0.0] * int(RATE * length_s)
    for index, frequency in enumerate(notes):
        start = int(RATE * (CHIME_LEAD + step * index))
        for i, sample in enumerate(soft_note(frequency, last_ring if index == len(notes) - 1 else ring, attack_s)):
            mix[start + i] += sample
    mix = low_pass(mix, LOOP_CUTOFF)
    top = max(abs(sample) for sample in mix)
    return [sample / top * peak for sample in mix]


def write_wav(path, samples):
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<h", round(sample * 32767)) for sample in samples))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    here = os.path.dirname(os.path.abspath(__file__))
    parser.add_argument("--out", default=os.path.join(here, "..", "..", "web", "res", "media", "intercom"))
    parser.add_argument("--cues", default=",".join([*CHIMES, *CUES, *LOOPS]))
    parser.add_argument("--prefix", default="", help="put before every file name")
    parser.add_argument("--wav", action="store_true", help="write .wav, without ffmpeg")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name in args.cues.split(","):
        if name in LOOPS:
            samples = render_loop(name)
        elif name in CHIMES:
            samples = render_chime(name)
        elif name in CUES:
            samples = render(name)
        else:
            sys.exit(f"Unknown cue: {name}")
        target = os.path.join(args.out, args.prefix + name)
        if args.wav:
            write_wav(target + ".wav", samples)
            continue
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, name + ".wav")
            write_wav(source, samples)
            # bitexact: no encoder version, no date and a fixed stream serial, so that the same
            # script and the same ffmpeg give the same bytes
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", source, "-map_metadata", "-1", "-fflags", "+bitexact",
                 "-flags:a", "+bitexact", "-c:a", "libvorbis", "-q:a", "5", target + ".ogg"],
                check=True,
            )
        print(target + ".ogg")


if __name__ == "__main__":
    main()
