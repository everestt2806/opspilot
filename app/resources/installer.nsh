!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
; Chay truoc uninstallOldVersion. Khong cho installer xoa legacy model chua bao toan.
!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\opspilot-legacy-ml.ps1 "${BUILD_RESOURCES_DIR}\..\scripts\legacy-ml-upgrade.ps1"
  File /oname=$PLUGINSDIR\opspilot-legacy-ml-policy.json "${BUILD_RESOURCES_DIR}\legacy-ml-policy.json"
  !ifndef OPSPILOT_UPGRADE_PROFILE
    !define OPSPILOT_UPGRADE_PROFILE "$APPDATA\OpsPilot"
  !endif
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\opspilot-legacy-ml.ps1" -InstallationDirectory "$INSTDIR" -UserDataDirectory "${OPSPILOT_UPGRADE_PROFILE}" -ExecutableName "${APP_EXECUTABLE_FILENAME}" -PolicyFile "$PLUGINSDIR\opspilot-legacy-ml-policy.json"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP|MB_OK "OpsPilot could not preserve existing ML models. Installation was stopped before removing the old version. Close OpsPilot and retry. If the problem remains, keep the old installation and use the upgrade checklist to back up its models."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

# Error propagation and safe transaction for uninstaller results.
# Ensures that full installer respects uninstaller rejection / failure, aborting before mutation.
!macro handleUnInstallCheckMacro ROOT_KEY
  ${If} ${Errors}
    DetailPrint "Uninstall was not successful. Not able to launch uninstaller!"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Uninstall was not successful. Not able to launch uninstaller!" /SD IDOK
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}

  ${If} $R0 == 0
    ClearErrors
  ${Else}
    Push $R1
    !insertmacro readReg $R1 "${ROOT_KEY}" "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${If} $R1 == ""
      !ifdef UNINSTALL_REGISTRY_KEY_2
        !insertmacro readReg $R1 "${ROOT_KEY}" "${UNINSTALL_REGISTRY_KEY_2}" DisplayVersion
      !endif
    ${EndIf}

    ${If} $R1 == "0.1.0"
      DetailPrint "Detected predecessor version 0.1.0 uninstaller failure ($R0). Performing guarded transaction."

      # Guard A: Pre-existing recovery backup directory check
      Push $1
      Push $2
      Push $3
      Push $4

      StrCpy $1 $INSTDIR
      StrCpy $2 $INSTDIR "" -1
      ${if} $2 == "\"
        StrCpy $1 $INSTDIR -1
      ${endif}
      StrCpy $3 "$1_b"

      ${If} ${FileExists} "$3\*.*"
        DetailPrint "Pre-existing recovery backup found at $3. Aborting upgrade to protect recovery data."
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "Pre-existing recovery backup found at $3. Aborting upgrade to protect recovery data." /SD IDOK
        ${EndIf}
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Pop $R1
        SetErrorLevel 2
        Quit
      ${EndIf}

      # Guard B: Running application process check
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR'.TrimEnd('\'); $$ppid = (Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID }).ParentProcessId; $$procs = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$ppid -and $$_.Name -notlike 'Uninstall*' -and $$_.Path -and ($$_.Path.Equals($$dir, 'CurrentCultureIgnoreCase') -or $$_.Path.StartsWith($$dir + '\', 'CurrentCultureIgnoreCase')) }); if ($$procs.Count -gt 0) { exit 1 } else { exit 0 }"`
      Pop $4
      ${If} $4 != 0
        DetailPrint "Application is currently running from $INSTDIR. Aborting upgrade."
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "Application is currently running from $INSTDIR. Please close it before upgrading." /SD IDOK
        ${EndIf}
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Pop $R1
        SetErrorLevel 2
        Quit
      ${EndIf}

      # Guard C: Safe transactional move
      CreateDirectory "$3"
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$src = '$INSTDIR'.TrimEnd('\'); $$dst = '$3'.TrimEnd('\'); try { $$items = @(Get-ChildItem -LiteralPath $$src -Force -ErrorAction Stop) } catch { exit 1 }; $$fail = 0; foreach ($$it in $$items) { try { Move-Item -LiteralPath $$it.FullName -Destination (Join-Path $$dst $$it.Name) -Force -ErrorAction Stop } catch { $$fail = 1; break } }; if ($$fail -ne 0) { exit 1 }; $$remaining = @(Get-ChildItem -LiteralPath $$src -Force -ErrorAction SilentlyContinue); if ($$remaining.Count -gt 0) { exit 1 }; exit 0"`
      Pop $4
      ${If} $4 != 0
        DetailPrint "Transactional move of legacy payload failed. Performing rollback."
        Push $R2
        nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$src = '$INSTDIR'.TrimEnd('\'); $$dst = '$3'.TrimEnd('\'); $$b_items = @(Get-ChildItem -LiteralPath $$dst -Force -ErrorAction SilentlyContinue); foreach ($$it in $$b_items) { try { Move-Item -LiteralPath $$it.FullName -Destination (Join-Path $$src $$it.Name) -Force -ErrorAction Stop } catch {} }; $$remaining_backup = @(Get-ChildItem -LiteralPath $$dst -Force -ErrorAction SilentlyContinue); if ($$remaining_backup.Count -gt 0) { exit 2 } else { try { Remove-Item -LiteralPath ('\\?\' + $$dst) -Recurse -Force -ErrorAction Stop } catch {}; exit 0 }"`
        Pop $R2
        ${If} $R2 == 2
          DetailPrint "Rollback incomplete: retaining recovery backup at $3."
          ${IfNot} ${Silent}
            MessageBox MB_OK|MB_ICONEXCLAMATION "Upgrade aborted: could not fully restore files. Recovery backup retained at $3." /SD IDOK
          ${EndIf}
        ${Else}
          DetailPrint "Rollback complete: all files restored to $INSTDIR."
          ${IfNot} ${Silent}
            MessageBox MB_OK|MB_ICONEXCLAMATION "Upgrade aborted: could not move legacy files from $INSTDIR." /SD IDOK
          ${EndIf}
        ${EndIf}
        Pop $R2
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Pop $R1
        SetErrorLevel 2
        Quit
      ${EndIf}

      # Transaction succeeded: legacy files safely moved to $3. Clean up backup directory and proceed with upgrade.
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$src = '$INSTDIR'.TrimEnd('\'); $$dst = '$3'.TrimEnd('\'); try { Remove-Item -LiteralPath ('\\?\' + $$dst) -Recurse -Force -ErrorAction Stop } catch { exit 1 }; $$rem_src = @(Get-ChildItem -LiteralPath $$src -Force -ErrorAction SilentlyContinue); if ($$rem_src.Count -gt 0) { exit 1 }; exit 0"`
      Pop $4
      ${If} $4 != 0
        DetailPrint "Failed to finalize legacy transaction cleanup. Aborting upgrade."
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "Failed to finalize upgrade cleanup. Aborting." /SD IDOK
        ${EndIf}
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Pop $R1
        SetErrorLevel 2
        Quit
      ${EndIf}

      RMDir "$INSTDIR"
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      ClearErrors
      Pop $R1
    ${Else}
      # Not 0.1.0 (e.g. 0.2.0, same-version reinstall, or unclassified version):
      # Must propagate uninstaller rejection/failure to full installer and stop.
      DetailPrint "Uninstall was not successful or rejected with error code: $R0."
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Uninstall was not successful. Uninstaller error code: $R0" /SD IDOK
      ${EndIf}
      Pop $R1
      SetErrorLevel $R0
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro handleUnInstallCheckMacro SHELL_CONTEXT
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro handleUnInstallCheckMacro HKEY_CURRENT_USER
!macroend
!endif

!macro customCheckAppRunning
  ${if} $INSTDIR != ""
  ${andIf} ${FileExists} "$INSTDIR\*.*"
    StrCpy $1 "0"
    ${if} ${isUpdated}
      StrCpy $1 "1"
    ${endif}

    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR'.TrimEnd('\'); $$isUp = '$1'; $$ppid = (Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID }).ParentProcessId; $$procs = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$ppid -and $$_.Name -notlike 'Uninstall*' -and $$_.Path -and ($$_.Path.Equals($$dir, 'CurrentCultureIgnoreCase') -or $$_.Path.StartsWith($$dir + '\', 'CurrentCultureIgnoreCase')) }); if ($$procs.Count -eq 0) { exit 0 }; if ($$isUp -eq '1') { $$procs | ForEach-Object { try { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Start-Sleep -Milliseconds 800; $$rem = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$ppid -and $$_.Name -notlike 'Uninstall*' -and $$_.Path -and ($$_.Path.Equals($$dir, 'CurrentCultureIgnoreCase') -or $$_.Path.StartsWith($$dir + '\', 'CurrentCultureIgnoreCase')) }); if ($$rem.Count -eq 0) { exit 0 } }; exit 1"`
    Pop $R0

    ${if} $R0 != 0
      ${ifNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "OpsPilot is running from this location. Please close it and retry." /SD IDCANCEL IDOK +2
        Quit
      ${else}
        SetErrorLevel 2
        Quit
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

!ifdef BUILD_UNINSTALLER
Var /GLOBAL unBackupDir

Function un.safeMoveItems
  Push $R1
  Push $R2
  Push $R3
  Push $R4

  StrCpy $R3 "$INSTDIR\*.*"
  FindFirst $R1 $R2 $R3

  loop:
    StrCmp $R2 "" break
    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue

    # Skip uninstaller executable itself so we never attempt to move the running process
!ifdef UNINSTALL_FILENAME
    StrCmp "$R2" "${UNINSTALL_FILENAME}" continue
!endif
    StrCpy $R4 $R2 10
    StrCmp $R4 "Uninstall " continue

    ClearErrors
    Rename "$INSTDIR\$R2" "$unBackupDir\$R2"
    ${If} ${Errors}
      StrCpy $R0 "$INSTDIR\$R2"
      FindClose $R1
      Goto done
    ${EndIf}

  continue:
    FindNext $R1 $R2
    Goto loop

  break:
    FindClose $R1
    StrCpy $R0 0

  done:
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
FunctionEnd

Function un.safeRestoreItems
  Push $R1
  Push $R2
  Push $R3

  StrCpy $R0 0

  StrCpy $R3 "$unBackupDir\*.*"
  FindFirst $R1 $R2 $R3

  loop:
    StrCmp $R2 "" break
    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue

    ClearErrors
    Rename "$unBackupDir\$R2" "$INSTDIR\$R2"
    ${if} ${Errors}
      IntOp $R0 $R0 + 1
      DetailPrint "Rollback failed to restore item: $R2"
    ${endif}

  continue:
    FindNext $R1 $R2
    Goto loop

  break:
    FindClose $R1
    Pop $R3
    Pop $R2
    Pop $R1
FunctionEnd

!macro customRemoveFiles
  ${if} ${isUpdated}
    # Transactional update safety on same volume
    StrCpy $1 $INSTDIR
    StrCpy $2 $INSTDIR "" -1
    ${if} $2 == "\"
      StrCpy $1 $INSTDIR -1
    ${endif}

    StrCpy $unBackupDir "$1_b"

    # R8 Guard: Pre-existing backup directory check
    # If backup directory already exists before mutation, reject to protect existing recovery data
    ${if} ${FileExists} "$unBackupDir"
      DetailPrint "Pre-existing recovery backup found at $unBackupDir. Aborting update before mutation to protect backup."
      Abort `OpsPilot could not update: pre-existing recovery backup directory found at $unBackupDir. Please inspect, restore, or remove it before updating.`
    ${endif}

    CreateDirectory "$unBackupDir"

    Call un.safeMoveItems

    ${if} $R0 != 0
      StrCpy $R5 $R0
      DetailPrint "File or directory is busy during update: $R5"

      Call un.safeRestoreItems
      # After un.safeRestoreItems, $R0 contains the number of restore errors

      ${if} $R0 != 0
        DetailPrint "Rollback could not restore all files ($R0 errors). Preserving recovery backup at $unBackupDir"
        Abort `OpsPilot update aborted: file is busy ($R5) and rollback failed to restore all items ($R0 errors). Recovery backup preserved at: $unBackupDir`
      ${else}
        # Rollback fully succeeded: safe to remove the now empty backup directory
        RMDir "$unBackupDir"
        Abort `OpsPilot could not update because a file is in use: $R5`
      ${endif}
    ${endif}

    SetOutPath $TEMP
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '\\?\$INSTDIR' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '\\?\$unBackupDir' -Recurse -Force -ErrorAction SilentlyContinue"`
    RMDir /r $INSTDIR
    RMDir /r "$unBackupDir"
  ${else}
    # Normal uninstall: running-app guard already verified no app is running
    SetOutPath $TEMP
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '\\?\$INSTDIR' -Recurse -Force -ErrorAction SilentlyContinue"`
    RMDir /r $INSTDIR
    ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      Abort `OpsPilot could not remove application executable because it is in use.`
    ${endif}
  ${endif}
!macroend
!endif
