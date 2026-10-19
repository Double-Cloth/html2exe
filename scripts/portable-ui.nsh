; 使用 NSIS 自带的现代窗口资源，保留 electron-builder 配置的应用图标。
!include "WinMessages.nsh"

; 与 DESIGN.md 对应的原生窗口颜色。
!define PORTABLE_CANVAS FAF9F5
!define PORTABLE_INK 141413
!define PORTABLE_BODY 3D3D3A
!define PORTABLE_MUTED 6C6A64
!define PORTABLE_PRIMARY CC785C
!define PORTABLE_HAIRLINE E6DFD8
!define PORTABLE_BODY_COLORREF 0x3A3D3D
!define PORTABLE_SURFACE_COLORREF 0xE8F0F5

ChangeUI all "${NSISDIR}\Contrib\UIs\modern.exe"
XPStyle on
SetFont "Microsoft YaHei UI" 9
Caption "${PRODUCT_NAME} · 自解压"
SubCaption 3 " "
SubCaption 4 " "
LoadLanguageFile "${NSISDIR}\Contrib\Language files\SimpChinese.nlf"
ShowInstDetails hide
DetailsButtonText "查看文件详情(&D)"
CompletedText "文件已准备就绪"
InstallColors ${PORTABLE_PRIMARY} ${PORTABLE_HAIRLINE}
InstProgressFlags smooth colored

Var PortableTitleFont

; 按对话框单位压缩日志区，保留系统 DPI 缩放和原生控件布局。
!macro PortableShrinkWindow HANDLE
  System::Call 'user32::GetWindowRect(p ${HANDLE}, p r2)'
  System::Call '*$2(i .r3, i .r4, i .r5, i .r6)'
  IntOp $5 $5 - $3
  IntOp $6 $6 - $4
  IntOp $6 $6 - $7
  System::Call 'user32::SetWindowPos(p ${HANDLE}, p 0, i 0, i 0, i r5, i r6, i 0x6)'
!macroend

!macro PortableMoveFooter ID
  GetDlgItem $1 $HWNDPARENT ${ID}
  System::Call 'user32::GetWindowRect(p r1, p r2)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r2, i 2)'
  System::Call '*$2(i .r3, i .r4)'
  IntOp $4 $4 - $7
  System::Call 'user32::SetWindowPos(p r1, p 0, i r3, i r4, i 0, i 0, i 0x5)'
!macroend

PageEx instfiles
  PageCallbacks "" PortableProgressShow
PageExEnd

Function PortableProgressShow
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7

  ; 颜色对应 DESIGN.md 的 canvas、ink、body、muted 与 primary。
  SetCtlColors $HWNDPARENT ${PORTABLE_INK} ${PORTABLE_CANVAS}
  GetDlgItem $0 $HWNDPARENT 1034
  SetCtlColors $0 "" ${PORTABLE_CANVAS}
  GetDlgItem $0 $HWNDPARENT 1039
  SetCtlColors $0 "" ${PORTABLE_CANVAS}
  GetDlgItem $0 $HWNDPARENT 1037
  CreateFont $PortableTitleFont "Garamond" 12 400
  SendMessage $0 ${WM_SETFONT} $PortableTitleFont 0
  SendMessage $0 ${WM_SETTEXT} 0 "STR:正在解压应用"
  SetCtlColors $0 ${PORTABLE_INK} ${PORTABLE_CANVAS}
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:文件将保存在当前 EXE 旁的文件夹中，完成后请手动启动。"
  SetCtlColors $0 ${PORTABLE_MUTED} ${PORTABLE_CANVAS}
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 ${PORTABLE_MUTED} ${PORTABLE_CANVAS}
  GetDlgItem $0 $HWNDPARENT 1256
  SetCtlColors $0 ${PORTABLE_MUTED} ${PORTABLE_CANVAS}

  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 ${PORTABLE_BODY} ${PORTABLE_CANVAS}
  GetDlgItem $1 $0 1006
  SetCtlColors $1 ${PORTABLE_BODY} ${PORTABLE_CANVAS}
  GetDlgItem $1 $0 1004
  ; 仅关闭进度条主题，确保 Windows 上显示设定的珊瑚色。
  System::Call 'uxtheme::SetWindowTheme(p r1, w "", w "")'
  GetDlgItem $1 $0 1016
  ; ListView 颜色使用 COLORREF（BGR），不能直接使用设计规范的 RGB。
  SendMessage $1 0x1024 0 ${PORTABLE_BODY_COLORREF}
  SendMessage $1 0x1026 0 ${PORTABLE_SURFACE_COLORREF}
  SendMessage $1 0x1001 0 ${PORTABLE_SURFACE_COLORREF}

  System::Call '*(i 0, i 0, i 0, i 72)p.r2'
  System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r2)'
  System::Call '*$2(i, i, i, i .r7)'
  !insertmacro PortableShrinkWindow $1
  !insertmacro PortableShrinkWindow $0
  !insertmacro PortableMoveFooter 1
  !insertmacro PortableMoveFooter 2
  !insertmacro PortableMoveFooter 3
  !insertmacro PortableMoveFooter 1028
  !insertmacro PortableMoveFooter 1256
  !insertmacro PortableShrinkWindow $HWNDPARENT
  System::Free $2

  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function .onGUIEnd
  System::Call 'gdi32::DeleteObject(p $PortableTitleFont)'
FunctionEnd
