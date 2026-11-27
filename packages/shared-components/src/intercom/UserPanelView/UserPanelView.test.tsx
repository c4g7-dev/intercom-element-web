/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { act, render, screen } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { fn } from "storybook/test";

import * as stories from "./UserPanelView.stories";
import { formatCountdown, UserPanelView, type UserPanelViewActions, type UserPanelViewSnapshot } from "./UserPanelView";
import { pingGraphPaths, type UserPanelConnection } from "./ConnectionPopover";
import { signalLevel } from "./SignalBars";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const {
    Default,
    InCall,
    MutedAndSharing,
    Reconnecting,
    CallOfAnotherApp,
    Muted,
    NoMicrophone,
    MicrophoneBlocked,
    InCallWithoutDevices,
    InCallDevicesBlocked,
    InCallCameraOn,
    InCallCannotShare,
    InCallFairConnection,
    ConnectionGood,
    ConnectionPoor,
    ConnectionWithoutDetails,
    AloneInCall,
    AloneInCallNarrow,
} = composeStories(stories);

class TestViewModel extends MockViewModel<UserPanelViewSnapshot> implements UserPanelViewActions {
    public onToggleMute = vi.fn();
    public onToggleDeafen = vi.fn();
    public onOpenSettings = vi.fn();
    public onOpenProfile = vi.fn();
    public onToggleCamera = vi.fn();
    public onToggleScreenShare = vi.fn();
    public onOpenShareSettings = vi.fn();
    public onLeaveCall = vi.fn();
    public onStayInCall = vi.fn();
    public onJumpToCall = vi.fn();
    public onConnectionDetails = vi.fn();
    public onOpenDiagnostics = vi.fn();
}

/** A view model whose snapshot the test changes, as the call does while the panel is on screen. */
class LiveViewModel extends TestViewModel {
    private readonly listeners = new Set<() => void>();
    public constructor(private live: UserPanelViewSnapshot) {
        super(live);
        this.getSnapshot = (): UserPanelViewSnapshot => this.live;
        this.subscribe = (listener: () => void): (() => void) => {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        };
    }
    public setSnapshot(snapshot: UserPanelViewSnapshot): void {
        act(() => {
            this.live = snapshot;
            for (const listener of this.listeners) listener();
        });
    }
}

const base: UserPanelViewSnapshot = {
    userId: "@ada:example.org",
    displayName: "Ada",
    presence: "online",
    muted: false,
    deafened: false,
};
const call = {
    roomName: "Lounge",
    reconnecting: false,
    cameraOn: false,
    screenSharing: false,
    canShareScreen: true,
    controllable: true,
};

describe("UserPanelView", () => {
    it("draws the avatar with the app's own avatar when given one", () => {
        const vm = new TestViewModel({ ...base, avatarUrl: "https://example.org/ada.png" });
        const renderAvatar = vi.fn(({ name }) => <span data-testid="app-avatar">{name}</span>);
        render(<UserPanelView vm={vm} renderAvatar={renderAvatar} />);

        expect(screen.getByTestId("app-avatar")).toBeInTheDocument();
        expect(renderAvatar).toHaveBeenCalledWith({
            id: "@ada:example.org",
            name: "Ada",
            url: "https://example.org/ada.png",
            size: "32px",
        });
    });

    it("shows who you are, with mute and deafen there while there is no call", () => {
        render(<Default />);
        expect(screen.getByRole("button", { name: "Ada: your profile" }).textContent).toMatch(/AdaOnline$/);
        expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Deafen" })).toHaveAttribute("aria-pressed", "false");
        // The settings are in the rail of spaces: no button for them here without an update
        expect(screen.queryByRole("button", { name: /^Settings/ })).toBeNull();
        expect(screen.queryByTestId("intercom-call-strip")).toBeNull();
    });

    it("shows the user's ID where there is no presence", () => {
        render(<UserPanelView vm={new TestViewModel({ ...base, presence: undefined })} />);
        expect(screen.getByText("@ada:example.org")).toBeInTheDocument();
    });

    it("shows the call strip while in a call", () => {
        render(<InCall />);
        expect(screen.getByRole("status")).toHaveTextContent("Voice connected");
        expect(screen.getByText("Lounge")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mute" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Share screen" })).toHaveAttribute("aria-pressed", "false");
    });

    it("shows what is off and what is on", () => {
        render(<MutedAndSharing />);
        // Deafened is muted too, and the microphone button says what pressing it does then
        expect(screen.getByRole("button", { name: "Unmute and undeafen" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Undeafen" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Stop sharing" })).toHaveAttribute("aria-pressed", "true");
    });

    it("says when the call is reconnecting", () => {
        render(<Reconnecting />);
        expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
    });

    it("offers only to leave a call it cannot control", () => {
        render(<CallOfAnotherApp />);
        expect(screen.getByRole("button", { name: "Leave the call" })).toBeEnabled();
        expect(screen.queryByRole("button", { name: "Camera" })).toBeNull();
        // Mute is the app's own and works whatever the call is
        expect(screen.getByRole("button", { name: "Mute" })).toBeEnabled();
    });

    it("shows mute and deafen without a call, and lets them be changed", async () => {
        const vm = new TestViewModel({ ...base, muted: true, deafened: false });
        render(<UserPanelView vm={vm} />);
        const unmute = screen.getByRole("button", { name: "Unmute" });
        expect(unmute).toBeEnabled();
        expect(unmute).toHaveAttribute("aria-pressed", "true");
        expect(unmute).toHaveAttribute("data-state", "muted");
        const deafen = screen.getByRole("button", { name: "Deafen" });
        expect(deafen).toHaveAttribute("aria-pressed", "false");
        const user = userEvent.setup();
        await user.click(unmute);
        await user.click(deafen);
        expect(vm.onToggleMute).toHaveBeenCalledTimes(1);
        expect(vm.onToggleDeafen).toHaveBeenCalledTimes(1);
    });

    it("passes every button on to the view model", async () => {
        const vm = new TestViewModel({ ...base, call });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Mute" }));
        await user.click(screen.getByRole("button", { name: "Deafen" }));
        await user.click(screen.getByRole("button", { name: "Ada: your profile" }));
        await user.click(screen.getByRole("button", { name: "Camera" }));
        await user.click(screen.getByRole("button", { name: "Share screen" }));
        await user.click(screen.getByRole("button", { name: "Screen share settings" }));
        await user.click(screen.getByRole("button", { name: "Leave the call" }));
        await user.click(screen.getByText("Lounge"));
        for (const action of [
            vm.onToggleMute,
            vm.onToggleDeafen,
            vm.onOpenProfile,
            vm.onToggleCamera,
            vm.onToggleScreenShare,
            vm.onOpenShareSettings,
            vm.onLeaveCall,
            vm.onJumpToCall,
        ]) {
            expect(action).toHaveBeenCalledTimes(1);
        }
    });
});

describe("UserPanelView, left alone in a private call", () => {
    it("writes what is left as minutes and seconds", () => {
        expect(formatCountdown(300_000)).toBe("5:00");
        expect(formatCountdown(299_001)).toBe("5:00");
        expect(formatCountdown(299_000)).toBe("4:59");
        expect(formatCountdown(61_000)).toBe("1:01");
        expect(formatCountdown(7_000)).toBe("0:07");
        expect(formatCountdown(600_000)).toBe("10:00");
        expect(formatCountdown(-1)).toBe("0:00");
    });

    it("shows no countdown in a call nothing counts down in", () => {
        render(<UserPanelView vm={new TestViewModel({ ...base, call })} />);
        expect(screen.queryByTestId("intercom-call-alone")).toBeNull();
        expect(screen.queryByRole("button", { name: "Stay" })).toBeNull();
    });

    it("counts down to when the call leaves, and follows a countdown that started over", () => {
        vi.useFakeTimers();
        try {
            let now = 1_000_000;
            const vm = new LiveViewModel({ ...base, call: { ...call, aloneDeadline: now + 299_000 } });
            render(<UserPanelView vm={vm} now={() => now} />);
            const time = screen.getByTestId("intercom-call-alone-time");
            expect(time).toHaveTextContent("4:59");
            expect(screen.getByTestId("intercom-call-alone")).toHaveAccessibleName(
                "You're alone in this call. Disconnecting in 4:59.",
            );

            now += 60_000;
            act(() => void vi.advanceTimersByTime(250));
            expect(time).toHaveTextContent("3:59");

            // The user stayed: the call tells another deadline
            vm.setSnapshot({ ...base, call: { ...call, aloneDeadline: now + 300_000 } });
            expect(screen.getByTestId("intercom-call-alone-time")).toHaveTextContent("5:00");

            // Somebody came back
            vm.setSnapshot({ ...base, call });
            expect(screen.queryByTestId("intercom-call-alone")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("stays and leaves with its buttons", async () => {
        const user = userEvent.setup();
        const vm = new TestViewModel({ ...base, call: { ...call, aloneDeadline: 500_000 } });
        render(<UserPanelView vm={vm} now={() => 400_000} />);
        await user.click(screen.getByRole("button", { name: "Stay" }));
        expect(vm.onStayInCall).toHaveBeenCalledTimes(1);
        expect(vm.onLeaveCall).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Leave" }));
        expect(vm.onLeaveCall).toHaveBeenCalledTimes(1);
    });

    it("is there in a call whose other controls cannot be driven from here", () => {
        const vm = new TestViewModel({ ...base, call: { ...call, controllable: false, aloneDeadline: 500_000 } });
        render(<UserPanelView vm={vm} now={() => 400_000} />);
        expect(screen.getByTestId("intercom-call-alone-time")).toHaveTextContent("1:40");
    });

    it("renders the stories of it, wide and narrow", () => {
        const wide = render(<AloneInCall />);
        expect(screen.getByTestId("intercom-call-alone-time")).toHaveTextContent("4:59");
        expect(screen.getByRole("button", { name: "Stay" })).toBeInTheDocument();
        wide.unmount();
        render(<AloneInCallNarrow />);
        expect(screen.getByTestId("intercom-call-alone-time")).toHaveTextContent("0:42");
    });
});

describe("UserPanelView, the share button's two parts", () => {
    it("offers the settings of the next share, and the audio of the one that is on", () => {
        const vm = new TestViewModel({ ...base, call });
        const { rerender } = render(<UserPanelView vm={vm} />);
        expect(screen.getByTestId("intercom-share-settings")).toHaveAccessibleName("Screen share settings");
        rerender(<UserPanelView vm={new TestViewModel({ ...base, call: { ...call, screenSharing: true } })} />);
        expect(screen.getByTestId("intercom-share-settings")).toHaveAccessibleName("Share audio sources");
    });

    it("says where no screen can be shared, and does nothing then", async () => {
        const vm = new TestViewModel({ ...base, call: { ...call, canShareScreen: false } });
        render(<UserPanelView vm={vm} />);
        const share = screen.getByRole("button", { name: "Share screen" });
        expect(share).toHaveAttribute("aria-disabled", "true");
        expect(share).toHaveAccessibleDescription("Screen sharing is not available here");
        const user = userEvent.setup();
        await user.click(share);
        await user.click(screen.getByTestId("intercom-share-settings"));
        expect(vm.onToggleScreenShare).not.toHaveBeenCalled();
        expect(vm.onOpenShareSettings).not.toHaveBeenCalled();
        // The camera is not the screen's business
        expect(screen.getByRole("button", { name: "Camera" })).not.toHaveAttribute("aria-disabled");
    });

    it("renders the story of it", () => {
        render(<InCallCannotShare />);
        expect(screen.getByRole("button", { name: "Share screen" })).toHaveAttribute("aria-disabled", "true");
    });
});

describe("UserPanelView, the four states of the microphone", () => {
    const badge = "svg[data-unavailable-badge]";

    it("is on: the microphone, a switch that is not pressed", () => {
        render(<Default />);
        const button = screen.getByRole("button", { name: "Mute" });
        expect(button).toHaveAttribute("data-state", "unmuted");
        expect(button).toHaveAttribute("aria-pressed", "false");
        expect(button).not.toHaveAttribute("aria-disabled", "true");
        expect(button.querySelector(badge)).toBeNull();
    });

    it("is muted: the struck-through microphone, without a badge", () => {
        render(<Muted />);
        const button = screen.getByRole("button", { name: "Unmute" });
        expect(button).toHaveAttribute("data-state", "muted");
        expect(button).toHaveAttribute("aria-pressed", "true");
        expect(button).not.toHaveAttribute("aria-disabled", "true");
        expect(button.querySelector(badge)).toBeNull();
    });

    it.each([
        ["no-device", NoMicrophone, "No microphone found"],
        ["no-permission", MicrophoneBlocked, "Microphone access blocked — check system settings"],
    ] as const)("is %s: the badge, the reason, and a button that does nothing", async (state, Story, reason) => {
        const onToggleMute = fn();
        render(<Story onToggleMute={onToggleMute} />);
        const button = screen.getByRole("button", { name: "Microphone" });
        expect(button).toHaveAttribute("data-state", state);
        expect(button).toHaveAttribute("aria-disabled", "true");
        expect(button).not.toHaveAttribute("aria-pressed");
        expect(button).toHaveAccessibleDescription(reason);
        expect(button.querySelector(badge)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^(Mute|Unmute)/ })).toBeNull();

        // It can be focused, so that it says why, and the tooltip says the same
        const user = userEvent.setup();
        await user.tab();
        await user.tab();
        expect(button).toHaveFocus();
        expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
        await user.click(button);
        await user.keyboard("{Enter}");
        expect(onToggleMute).not.toHaveBeenCalled();
        // Deafen is not the microphone's business
        expect(screen.getByRole("button", { name: "Deafen" })).not.toHaveAttribute("aria-disabled", "true");
    });

    it("shows no microphone rather than muted, whatever the user's mute is", () => {
        render(<UserPanelView vm={new TestViewModel({ ...base, muted: true, micUnavailable: "no-device" })} />);
        expect(screen.getByRole("button", { name: "Microphone" })).toHaveAttribute("data-state", "no-device");
        expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull();
    });
});

describe("UserPanelView, the four states of the camera", () => {
    const badge = "svg[data-unavailable-badge]";

    it("is off, then on: a switch, without a badge", () => {
        const { unmount } = render(<InCall />);
        const off = screen.getByRole("button", { name: "Camera" });
        expect(off).toHaveAttribute("aria-pressed", "false");
        expect(off.querySelector(badge)).toBeNull();
        unmount();

        render(<InCallCameraOn />);
        const on = screen.getByRole("button", { name: "Camera" });
        expect(on).toHaveAttribute("aria-pressed", "true");
        expect(on).not.toHaveAttribute("aria-disabled");
        expect(on.querySelector(badge)).toBeNull();
    });

    it.each([
        ["no-device", InCallWithoutDevices, "No camera found", "No microphone found"],
        [
            "no-permission",
            InCallDevicesBlocked,
            "Camera access blocked — check system settings",
            "Microphone access blocked — check system settings",
        ],
    ] as const)(
        "is %s: the badge, the reason, and a button that does nothing",
        async (state, Story, reason, micReason) => {
            const onToggleCamera = fn();
            render(<Story onToggleCamera={onToggleCamera} />);
            const button = screen.getByRole("button", { name: "Camera" });
            expect(button).toHaveAttribute("data-state", state);
            expect(button).toHaveAttribute("aria-disabled", "true");
            expect(button).not.toHaveAttribute("aria-pressed");
            expect(button).not.toHaveAttribute("disabled");
            expect(button).toHaveAccessibleDescription(reason);
            expect(button.querySelector(badge)).toBeInTheDocument();
            await userEvent.click(button);
            expect(onToggleCamera).not.toHaveBeenCalled();

            // The microphone of the same call, and what still works in it
            expect(screen.getByRole("button", { name: "Microphone" })).toHaveAccessibleDescription(micReason);
            expect(screen.getByRole("button", { name: "Share screen" })).not.toHaveAttribute("aria-disabled");
            expect(screen.getByRole("button", { name: "Leave the call" })).toBeEnabled();
        },
    );
});

describe("UserPanelView, with an update of the app", () => {
    it("puts a dot on the settings button while an update waits for a restart", async () => {
        const vm = new TestViewModel(base);
        const { rerender } = render(<UserPanelView vm={vm} />);
        expect(screen.queryByTestId("intercom-update-dot")).toBeNull();
        expect(screen.queryByRole("button", { name: /^Settings/ })).toBeNull();

        rerender(<UserPanelView vm={vm} updateReady />);
        expect(screen.getByTestId("intercom-update-dot")).toBeInTheDocument();
        // The button says so too, and still opens the settings
        await userEvent.click(screen.getByRole("button", { name: "Settings (an update is ready)" }));
        expect(vm.onOpenSettings).toHaveBeenCalledTimes(1);
    });
});

describe("UserPanelView, the signal bars", () => {
    const bars = (): Element => screen.getByTestId("intercom-connection-trigger").querySelector("svg")!;

    it("shows connected or reconnecting for a call that tells no more", () => {
        expect(signalLevel(false, undefined)).toBe("good");
        expect(signalLevel(true, undefined)).toBe("reconnecting");
        const vm = new LiveViewModel({ ...base, call });
        render(<UserPanelView vm={vm} />);
        expect(bars()).toHaveAttribute("data-lit", "3");
        vm.setSnapshot({ ...base, call: { ...call, reconnecting: true } });
        expect(bars()).toHaveAttribute("data-lit", "1");
        expect(bars()).toHaveAttribute("data-level", "reconnecting");
    });

    it("shows three, two or one bar for a good, fair or poor connection", () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, quality: "good" } });
        render(<UserPanelView vm={vm} />);
        expect(bars()).toHaveAttribute("data-lit", "3");
        vm.setSnapshot({ ...base, call: { ...call, quality: "fair" } });
        expect(bars()).toHaveAttribute("data-lit", "2");
        expect(bars().parentElement).toHaveAttribute("data-level", "fair");
        vm.setSnapshot({ ...base, call: { ...call, quality: "poor" } });
        expect(bars()).toHaveAttribute("data-lit", "1");
        // Reconnecting is the one red bar whatever was told last
        vm.setSnapshot({ ...base, call: { ...call, quality: "good", reconnecting: true } });
        expect(bars()).toHaveAttribute("data-level", "reconnecting");
    });

    it("renders the story of a fair connection", () => {
        const { container } = render(<InCallFairConnection />);
        expect(container.querySelector("[data-level='fair']")).not.toBeNull();
    });
});

describe("UserPanelView, the details of the connection", () => {
    const connection: UserPanelConnection = {
        pingMs: 31.4,
        averagePingMs: 34,
        pingHistory: [null, 30, 36, 31],
        lossOutPct: 0.3,
        lossInPct: 1,
        jitterMs: 7.6,
        server: "sfu.example.org",
        transport: "turn-tls",
        encrypted: true,
        audio: { codec: "opus", bitrate: 32_000 },
        share: { width: 2560, height: 1440, fps: 29.97, bitrate: 3_200_000 },
    };
    const trigger = (): HTMLElement => screen.getByRole("button", { name: /Voice connected/ });
    const card = (): HTMLElement | null => screen.queryByRole("dialog", { name: "Voice connection" });

    it("opens from the bars and the state, and closes with another click", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, quality: "good", connection } });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        expect(trigger()).toHaveAttribute("aria-expanded", "false");
        expect(trigger()).not.toHaveAttribute("aria-controls");
        expect(card()).toBeNull();
        expect(vm.onConnectionDetails).not.toHaveBeenCalled();

        await user.click(trigger());
        expect(trigger()).toHaveAttribute("aria-expanded", "true");
        expect(trigger()).toHaveAttribute("aria-controls", card()!.id);
        expect(card()).toHaveFocus();
        expect(vm.onConnectionDetails).toHaveBeenLastCalledWith(true);
        // The room's name still leads to the call, and that is all it does
        expect(vm.onJumpToCall).not.toHaveBeenCalled();

        await user.click(trigger());
        expect(card()).toBeNull();
        expect(vm.onConnectionDetails).toHaveBeenLastCalledWith(false);
        expect(vm.onConnectionDetails).toHaveBeenCalledTimes(2);
    });

    it("shows what the call tells", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, quality: "good", connection } });
        render(<UserPanelView vm={vm} />);
        await userEvent.click(trigger());
        expect(screen.getByTestId("intercom-connection-level")).toHaveTextContent("Good");
        expect(screen.getByTestId("intercom-connection-ping")).toHaveTextContent("31 ms");
        const text = card()!.textContent;
        expect(text).toContain("avg 34 ms");
        expect(text).toContain("Packet loss↑ Sent 0.3 %↓ Received 1.0 %");
        expect(text).toContain("Jitter8 ms");
        expect(text).toContain("Serversfu.example.org");
        expect(text).toContain("TransportTURN relay (TLS)");
        expect(text).toContain("EncryptionEnd-to-end");
        expect(text).toContain("Microphoneopus · 32 kbps");
        expect(text).toContain("Screen share2560×1440 · 30 fps · 3.2 Mbps");
        expect(screen.getByRole("img", { name: "Ping over the last minute" })).toBeInTheDocument();

        // And follows it
        vm.setSnapshot({
            ...base,
            call: { ...call, quality: "poor", connection: { pingHistory: [300], pingMs: 300, encrypted: false } },
        });
        expect(screen.getByTestId("intercom-connection-level")).toHaveTextContent("Poor");
        expect(screen.getByTestId("intercom-connection-ping")).toHaveTextContent("300 ms");
        expect(card()!.textContent).toContain("EncryptionOff");
        expect(card()!.textContent).not.toContain("Screen share");
    });

    it("closes with Escape, and gives the focus back to what opened it", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, connection } });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        trigger().focus();
        await user.keyboard("{Enter}");
        expect(card()).toHaveFocus();
        await user.keyboard("{Escape}");
        expect(card()).toBeNull();
        expect(trigger()).toHaveFocus();
        expect(vm.onConnectionDetails).toHaveBeenLastCalledWith(false);
    });

    it("closes with a click outside, and not with one inside", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, connection } });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        await user.click(trigger());
        await user.click(screen.getByText("Jitter"));
        expect(card()).not.toBeNull();
        await user.click(screen.getByRole("button", { name: "Ada: your profile" }));
        expect(card()).toBeNull();
    });

    it("closes when the keyboard leaves it", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, connection } });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        await user.click(trigger());
        await user.tab();
        expect(screen.getByRole("button", { name: "Open diagnostics" })).toHaveFocus();
        expect(card()).not.toBeNull();
        act(() => screen.getByRole("button", { name: "Mute" }).focus());
        expect(card()).toBeNull();
    });

    it("opens the diagnostics, and closes for it", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, connection } });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        await user.click(trigger());
        await user.click(screen.getByRole("button", { name: "Open diagnostics" }));
        expect(vm.onOpenDiagnostics).toHaveBeenCalledTimes(1);
        expect(card()).toBeNull();
    });

    it("closes with the call, and stays closed in the next one", async () => {
        const vm = new LiveViewModel({ ...base, call: { ...call, connection } });
        render(<UserPanelView vm={vm} />);
        await userEvent.click(trigger());
        vm.setSnapshot(base);
        expect(card()).toBeNull();
        expect(vm.onConnectionDetails).toHaveBeenLastCalledWith(false);
        vm.setSnapshot({ ...base, call });
        expect(card()).toBeNull();
    });

    it("says so where the call tells nothing, and still offers the diagnostics", async () => {
        render(<ConnectionWithoutDetails />);
        await userEvent.click(trigger());
        expect(card()!.textContent).toContain("This call does not tell how its connection is.");
        // Connected is all that is known of it
        expect(screen.getByTestId("intercom-connection-level")).toHaveTextContent("Connected");
        expect(screen.queryByTestId("intercom-connection-graph")).toBeNull();
        expect(screen.getByRole("button", { name: "Open diagnostics" })).toBeInTheDocument();
    });

    it("renders the stories of it, opened", async () => {
        const good = render(<ConnectionGood />);
        await userEvent.click(trigger());
        expect(screen.getByTestId("intercom-connection-level")).toHaveTextContent("Good");
        expect(card()!.textContent).toContain("TransportUDP");
        good.unmount();
        expect(card()).toBeNull();
        render(<ConnectionPoor />);
        await userEvent.click(trigger());
        expect(screen.getByTestId("intercom-connection-level")).toHaveTextContent("Poor");
        expect(card()!.textContent).toContain("TransportTURN relay (TLS)");
    });

    it("draws the times as a line with a gap where none is known", () => {
        expect(pingGraphPaths([]).line).toBe("");
        const { line, area, scaleMs } = pingGraphPaths([null, 40, 80, null, 100]);
        // 100 ms with a fifth of room above it
        expect(scaleMs).toBe(120);
        expect(line.match(/M/g)).toHaveLength(2);
        expect(line.startsWith("M60.0 ")).toBe(true);
        expect(area.match(/Z/g)).toHaveLength(2);
        // A steady low ping is a low line, not a full graph
        expect(pingGraphPaths([20, 20]).scaleMs).toBe(80);
    });
});
