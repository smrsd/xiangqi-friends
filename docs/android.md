# Android 客户端

源码包名 `io.xiangqifriends.app`，最低 Android 8（API 26），目标 API 35。原生 Java Activity 内嵌响应式网页，支持地址设置、加载进度、网络失败重试、系统返回键和进程恢复。

默认网址为 https://xiangqi-friends-smrsd.thelittleprince.chatgpt.site/ 。用户可以在“地址”页切换自建服务器。只接受 HTTPS 根地址，调试版本额外允许 localhost 与 Android 模拟器 10.0.2.2。禁用文件访问、混合内容、JS 原生桥；拒绝无效 TLS 证书；跨域导航交给系统浏览器。

## 当前电脑构建

```powershell
cd D:\CodeInD\xiangqi-friends
.\android\test.ps1
.\android\build.ps1
```

脚本默认使用 `D:\Dev\jdk-17`、`D:\Dev\Android\sdk`，自动选择 SDK 中的稳定 build-tools。也可传入 `-SdkPath`、`-JavaHome`、`-ServerUrl`。通过 SDK aapt2/javac/D8/zipalign/apksigner 直接构建，不必额外下载 Gradle。

输出 `android/build/xiangqifriends-debug.apk` 及 SHA256 文件。把 APK 传到自己的安卓手机后安装即可；系统可能需要允许该文件来源安装应用。构建脚本使用项目构建目录内的调试密钥，Git 忽略此密钥。需要后续原位更新时保留该密钥。

正式发布可运行 `android/build.ps1 -Configuration Release` 生成未签名产物，再用自己的持久发布密钥签名。Gradle 工程可在 Android Studio 打开，安装与构建所需工具版本见配置文件。GitHub Actions 同样生成调试 APK 供下载。

验证边界：已本地构建并校验 APK 签名和对齐；未连接 Android 真机或模拟器时，实际安装、屏幕适配和系统 WebView 行为仍需要设备验收。
