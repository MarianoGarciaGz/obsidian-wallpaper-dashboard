Set oShell = CreateObject("WScript.Shell")
Dim serverPath
serverPath = "C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\index\server"
oShell.Run "node """ & serverPath & "\index.js""", 0, False
