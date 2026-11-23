/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useState, type JSX } from "react";
import { IconButton, Menu, MenuItem, ReleaseAnnouncement } from "@vector-im/compound-web";
import VolumeOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/volume-on";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import RoomIcon from "@vector-im/compound-design-tokens/assets/web/icons/room";
import SectionIcon from "@vector-im/compound-design-tokens/assets/web/icons/section";
import PlusIcon from "@vector-im/compound-design-tokens/assets/web/icons/plus";

import { type RoomListHeaderViewModel } from "../RoomListHeaderView";
import { useI18n } from "../../../core/i18n/i18nContext";
import { useViewModel } from "../../../core/viewmodel";

interface ComposeMenuViewProps {
    /**
     * The view model for the room list header
     */
    vm: RoomListHeaderViewModel;
}

/**
 * A menu component that provides options for creating new conversations.
 * Displays a dropdown menu with options to start a chat, create a room, or create a video room.
 *
 * @example
 * ```tsx
 * <ComposeMenuView vm={roomListHeaderViewModel} />
 * ```
 */
export function ComposeMenuView({ vm }: ComposeMenuViewProps): JSX.Element {
    const { translate: _t } = useI18n();
    const [open, setOpen] = useState(false);
    const {
        canCreateRoom,
        canCreateVideoRoom,
        displaySectionReleaseAnnouncement,
        areSectionsEnabled,
        displaySpaceMenu,
    } = useViewModel(vm);
    // InterCom: in a space the rooms are its channels, for text or for voice
    const inSpace = displaySpaceMenu;

    // 28px button with a 20px icon
    const button = (
        <IconButton size="28px" style={{ padding: "4px" }} tooltip={_t("action|new_conversation")}>
            <PlusIcon color="var(--cpd-color-icon-secondary)" aria-hidden />
        </IconButton>
    );

    if (displaySectionReleaseAnnouncement) {
        return (
            <ReleaseAnnouncement
                open={displaySectionReleaseAnnouncement}
                onClick={vm.closeSectionReleaseAnnouncement}
                header={_t("release_announcement|room_list_section_title")}
                description={_t("release_announcement|room_list_section_description")}
                closeLabel={_t("release_announcement|room_list_section_close")}
            >
                {button}
            </ReleaseAnnouncement>
        );
    }

    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            showTitle={false}
            title={_t("action|open_menu")}
            align="start"
            trigger={button}
        >
            <MenuItem Icon={ChatIcon} label={_t("action|start_chat")} onSelect={vm.createChatRoom} hideChevron />
            {canCreateRoom && (
                <MenuItem
                    Icon={RoomIcon}
                    label={inSpace ? _t("intercom|voice|new_text_channel") : _t("action|new_room")}
                    onSelect={vm.createRoom}
                    hideChevron
                />
            )}
            {canCreateVideoRoom && (
                <MenuItem
                    Icon={VolumeOnIcon}
                    label={inSpace ? _t("intercom|voice|new_voice_channel") : _t("intercom|voice|new_voice_room")}
                    onSelect={vm.createVideoRoom}
                    hideChevron
                />
            )}
            {areSectionsEnabled && (
                <MenuItem Icon={SectionIcon} label={_t("action|new_section")} onSelect={vm.createSection} hideChevron />
            )}
        </Menu>
    );
}
