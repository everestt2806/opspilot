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
