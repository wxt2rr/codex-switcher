!include "nsProcess.nsh"

!macro customCheckAppRunning
  retry_close:
  DetailPrint `Closing running "${PRODUCT_NAME}" processes...`
  nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Sleep 1200

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint `Retrying cleanup for "${PRODUCT_NAME}"...`
    nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Sleep 1800
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${EndIf}

  ${If} $R0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY retry_close
    Quit
  ${EndIf}
!macroend
