/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { act, render, screen, within } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";

import * as stories from "./CallEventTileView.stories";
import { CallEventTileView, type CallEventTileViewActions, type CallEventTileViewSnapshot } from "./CallEventTileView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const { Ongoing, OngoingSixPeople, OngoingJoined, Ringing, Ended, Missed, Declined, OngoingVideo } =
    composeStories(stories);

const tile = (): HTMLElement => screen.getByTestId("call-tile");

describe("CallEventTileView", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows a running call: who started it, who is in it, for how long, and a way in", () => {
        render(<Ongoing />);
        expect(tile()).toHaveAttribute("data-state", "ongoing");
        expect(tile().textContent).toContain("Ada started a call");
        expect(screen.getByRole("img", { name: "2 people in the call" })).toHaveAttribute("title", "Ada, Ben");
        expect(screen.getByRole("timer")).toHaveTextContent("0:06");
        expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
        expect(tile().textContent).not.toContain("In call");
        expect(tile().textContent).toContain("21:21");
    });

    it("shows four of six people and counts the others", () => {
        render(<OngoingSixPeople />);
        const people = screen.getByRole("img", { name: "6 people in the call" });
        expect(people.querySelectorAll("[data-type='round']")).toHaveLength(4);
        expect(within(people).getByText("+2")).toBeInTheDocument();
        expect(tile().textContent).toContain("Dee Marlow started a call");
        expect(screen.getByRole("timer")).toHaveTextContent("4:12");
    });

    it("says that the user is in the call and offers to leave", () => {
        render(<OngoingJoined />);
        expect(tile().textContent).toContain("In call");
        expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
        expect(screen.getByRole("timer")).toHaveTextContent("1:12:03");
    });

    it("shows a call that rings, with both answers", () => {
        render(<Ringing />);
        expect(tile()).toHaveAttribute("data-state", "ringing");
        expect(tile().textContent).toContain("Ben is calling");
        expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Decline", "Accept"]);
        expect(screen.queryByRole("timer")).toBeNull();
    });

    it("shows a call that is over with how long it took", () => {
        render(<Ended />);
        expect(tile()).toHaveAttribute("data-state", "ended");
        expect(tile().textContent).toContain("Call ended · 6 s");
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("timer")).toBeNull();
        expect(tile().textContent).toContain("21:21");
    });

    it("shows a missed call", () => {
        render(<Missed />);
        expect(tile()).toHaveAttribute("data-state", "missed");
        expect(tile().textContent).toContain("Missed call");
        expect(screen.getByRole("button", { name: "Call back" })).toBeInTheDocument();
    });

    it("shows a declined call", () => {
        render(<Declined />);
        expect(tile()).toHaveAttribute("data-state", "declined");
        expect(tile().textContent).toContain("Call declined");
    });

    it("says that the user started the call themselves", () => {
        render(<OngoingVideo />);
        expect(tile().textContent).toContain("You started a call");
    });

    const snapshot: CallEventTileViewSnapshot = {
        state: "ongoing",
        video: false,
        outgoing: false,
        startedByName: "Ada",
        time: "21:21",
        participants: [],
        joined: false,
        buttons: ["join"],
    };

    it("hands a click on a button to the view model", async () => {
        const onButton = vi.fn();
        const vm = new MockViewModel<CallEventTileViewSnapshot>(snapshot) as MockViewModel<CallEventTileViewSnapshot> &
            CallEventTileViewActions;
        vm.onButton = onButton;
        render(<CallEventTileView vm={vm} />);

        await userEvent.click(screen.getByRole("button", { name: "Join" }));

        expect(onButton).toHaveBeenCalledWith("join", expect.anything());
    });

    it("does not let a disabled button be used, and says what the app says instead of its own text", async () => {
        const onButton = vi.fn();
        const vm = new MockViewModel<CallEventTileViewSnapshot>({
            ...snapshot,
            state: "ended",
            title: "Answered elsewhere",
            buttons: ["call_back"],
            disabledButtons: ["call_back"],
        }) as MockViewModel<CallEventTileViewSnapshot> & CallEventTileViewActions;
        vm.onButton = onButton;
        render(<CallEventTileView vm={vm} />);

        expect(tile().textContent).toContain("Answered elsewhere");
        await userEvent.click(screen.getByRole("button", { name: "Call back" }));
        expect(onButton).not.toHaveBeenCalled();
    });

    it("counts a running call up every second", () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const vm = new MockViewModel<CallEventTileViewSnapshot>({
            ...snapshot,
            startedAt: 1_000_000 - 59_000,
        }) as MockViewModel<CallEventTileViewSnapshot> & CallEventTileViewActions;
        vm.onButton = vi.fn();
        render(<CallEventTileView vm={vm} />);
        expect(screen.getByRole("timer")).toHaveTextContent("0:59");

        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(screen.getByRole("timer")).toHaveTextContent("1:01");
    });
});
