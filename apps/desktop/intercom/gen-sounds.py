#!/usr/bin/env python3
# Copyright 2026 The InterCom contributors
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
# Please see LICENSE files in the repository root for full details.
"""Makes InterCom's sound cues: short, soft chimes of two notes, worked out here from sines.

    gen-sounds.py [--out DIR] [--cues join,leave,...] [--wav]

Nothing is sampled from anywhere: every file is the output of this script, which is why the
cues can be shipped under the project's own licence. The notes rise where something comes on
(join, unmute, undeafen) and fall where it goes off (leave, mute, deafen).

Needs python 3 and ffmpeg with libvorbis (for .ogg); --wav writes the uncompressed files instead
and needs nothing. The same script makes the two cues of the call (join, leave) in InterCom's
Element Call fork, src/sound/intercom_*.ogg.
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
    "join": ((587.33, 880.00), 0.11, 0.30),  # D5, A5
    "leave": ((880.00, 587.33), 0.11, 0.30),  # A5, D5
    # Mute and deafen come often (hotkeys): an octave lower than they were, and softer (SOFT)
    "unmute": ((329.63, 493.88), 0.08, 0.16),  # E4, B4
    "mute": ((493.88, 329.63), 0.08, 0.16),  # B4, E4
    "undeafen": ((261.63, 349.23), 0.10, 0.24),  # C4, F4
    "deafen": ((349.23, 261.63), 0.10, 0.24),  # F4, C4
}

# Cues played quieter, with a slower attack and less of the octave: (peak, attack in s, octave)
SOFT = {name: (0.15, 0.014, 0.06) for name in ("unmute", "mute", "undeafen", "deafen")}
DEFAULT_TONE = (PEAK, 0.006, 0.18)


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
    parser.add_argument("--cues", default=",".join(CUES))
    parser.add_argument("--prefix", default="", help="put before every file name")
    parser.add_argument("--wav", action="store_true", help="write .wav, without ffmpeg")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name in args.cues.split(","):
        if name not in CUES:
            sys.exit(f"Unknown cue: {name}")
        samples = render(name)
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
