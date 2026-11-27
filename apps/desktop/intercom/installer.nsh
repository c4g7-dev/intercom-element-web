# Lattice: what the installer does besides electron-builder's own script, which includes this
# file (nsis.include in electron-builder.ts). It is about one thing: the app was called "InterCom"
# up to 1.12.35-intercom.14, and an install of that is updated in place.
#
# What stays the same, so that the update is an update and not a second install:
#   - the install directory, %LOCALAPPDATA%\Programs\intercom (from the package name)
#   - the program file, InterCom.exe (win.executableName), and "Uninstall InterCom.exe"
#   - the registry keys of the install and of its entry under "Apps" (both from the app id)
#   - the profile, %APPDATA%\InterCom
#
# What electron-builder's script does by itself on such an update (templates/nsis: setLinkVars,
# addStartMenuLink, addDesktopLink, registryAddInstallInfo), run silently by the app's updater or
# by hand:
#   - it reads the old shortcut name ("InterCom") from the registry and renames the Start menu
#     shortcut and, if it is still there, the desktop shortcut to "Lattice.lnk"; a desktop
#     shortcut that was deleted is not made again
#   - it writes the new name to the entry under "Apps" (DisplayName "Lattice <version>") and
#     remembers "Lattice" as the shortcut name for the next update and for the uninstaller
#
# What is left for this file, after the files and the shortcuts are in place (customInstall):
#   1. a shortcut under the old name that is still there beside the new one (a failed rename, a
#      copy somebody made) is removed, in the Start menu and on the desktop; where only the old
#      one is, it is renamed
#   2. the Start menu shortcut, which was renamed and still says "InterCom" in its description,
#      is written again. It is the one Windows names the app's notifications after.
#   3. the shell is told that icons changed, so that the new icon is drawn
#
# What is deliberately left alone:
#   - the desktop shortcut beyond its name, and the shortcut of an icon pinned to the taskbar
#     (%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InterCom.lnk).
#     People put switches of their own into these (--profile, --hidden), and writing them again
#     would drop those. Both go on working, as their target, the program file, did not move, and
#     both show the new icon, which they take from it. The pinned one keeps its file name, by
#     which Windows knows the pin; pinning anew gives it the new name.
#
# Nothing here asks a question or can fail the installation: every step is checked for the file
# it is about and errors are cleared.

!define /ifndef LATTICE_OLD_SHORTCUT_NAME "InterCom"

# Writes a shortcut to the app again where one is: same place, new description and icon.
!macro latticeRefreshShortcut LINK
  ${if} ${FileExists} "${LINK}"
    CreateShortCut "${LINK}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "${LINK}" "${APP_ID}"
  ${endIf}
!macroend

# Removes OLD_LINK where NEW_LINK is there as well. Where only the old one is, it becomes the new one.
!macro latticeReplaceShortcut OLD_LINK NEW_LINK
  ${if} "${OLD_LINK}" != "${NEW_LINK}"
  ${andIf} ${FileExists} "${OLD_LINK}"
    ${if} ${FileExists} "${NEW_LINK}"
      WinShell::UninstShortcut "${OLD_LINK}"
      Delete "${OLD_LINK}"
    ${else}
      Rename "${OLD_LINK}" "${NEW_LINK}"
    ${endIf}
    ClearErrors
  ${endIf}
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    # 1. ($newStartMenuLink is in a directory of its own only if the build names one; this one does not)
    !insertmacro latticeReplaceShortcut "$SMPROGRAMS\${LATTICE_OLD_SHORTCUT_NAME}.lnk" "$newStartMenuLink"
    # 2.
    !insertmacro latticeRefreshShortcut "$newStartMenuLink"
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    # 1.
    !insertmacro latticeReplaceShortcut "$DESKTOP\${LATTICE_OLD_SHORTCUT_NAME}.lnk" "$newDesktopLink"
  !endif

  # 3. SHCNE_ASSOCCHANGED: icons are read again
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
