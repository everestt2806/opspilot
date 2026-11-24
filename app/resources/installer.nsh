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
!endif

!macro customCheckAppRunning
  ${if} $INSTDIR != ""
  ${andIf} ${FileExists} "$INSTDIR\*.*"
    StrCpy $1 "0"
    ${if} ${isUpdated}
      StrCpy $1 "1"
    ${endif}

    nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR'.TrimEnd('\'); $$isUp = '$1'; $$ppid = (Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID }).ParentProcessId; $$procs = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$ppid -and $$_.Name -notlike 'Uninstall*' -and $$_.Path -and ($$_.Path.Equals($$dir, 'CurrentCultureIgnoreCase') -or $$_.Path.StartsWith($$dir + '\', 'CurrentCultureIgnoreCase')) }); if ($$procs.Count -eq 0) { exit 0 }; if ($$isUp -eq '1') { $$procs | ForEach-Object { try { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Start-Sleep -Milliseconds 800; $$rem = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$ppid -and $$_.Name -notlike 'Uninstall*' -and $$_.Path -and ($$_.Path.Equals($$dir, 'CurrentCultureIgnoreCase') -or $$_.Path.StartsWith($$dir + '\', 'CurrentCultureIgnoreCase')) }); if ($$rem.Count -eq 0) { exit 0 } }; exit 1"`
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

  StrCpy $R3 "$unBackupDir\*.*"
  FindFirst $R1 $R2 $R3

  loop:
    StrCmp $R2 "" break
    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue

    ClearErrors
    Rename "$unBackupDir\$R2" "$INSTDIR\$R2"

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
    nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '\\?\$unBackupDir' -Recurse -Force -ErrorAction SilentlyContinue"`
    CreateDirectory "$unBackupDir"

    Call un.safeMoveItems

    ${if} $R0 != 0
      DetailPrint "File or directory is busy during update: $R0"

      Call un.safeRestoreItems

      nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '\\?\$unBackupDir' -Recurse -Force -ErrorAction SilentlyContinue"`

      Abort `OpsPilot could not update because a file is in use: $R0`
    ${endif}

    SetOutPath $TEMP
    nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '\\?\$INSTDIR' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '\\?\$unBackupDir' -Recurse -Force -ErrorAction SilentlyContinue"`
    RMDir /r $INSTDIR
    RMDir /r "$unBackupDir"
  ${else}
    # Normal uninstall: running-app guard already verified no app is running
    SetOutPath $TEMP
    nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '\\?\$INSTDIR' -Recurse -Force -ErrorAction SilentlyContinue"`
    RMDir /r $INSTDIR
    ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      Abort `OpsPilot could not remove application executable because it is in use.`
    ${endif}
  ${endif}
!macroend
!endif
