// WHOSCOFFEE 네이티브 앱 창 (WebView2) — 단일 exe
// WebView2 DLL 3개를 exe 리소스로 임베드하고 런타임에 로드한다.
//   - 관리 DLL(Core/WinForms): AssemblyResolve 로 메모리 로드
//   - 네이티브 DLL(WebView2Loader): 임시폴더에 풀고 검색경로 등록
// build-viewer.ps1 이 csc /resource 로 임베드 + __APPURL__ 치환 + /win32icon.
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("WHOSCOFFEE")]
[assembly: AssemblyProduct("WHOSCOFFEE")]
[assembly: AssemblyCompany("WHOSCOFFEE")]
[assembly: AssemblyDescription("커피 품앗이 알리미")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyVersion("1.0.0.0")]

class Viewer
{
    const string APP_VERSION = "1.0.0"; // 네이티브 버전 (새 빌드 시 index.html EXE_LATEST 과 함께 올림)

    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    static extern bool SetDllDirectory(string path);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [STAThread]
    static void Main(string[] args)
    {
        // 작업표시줄 아이콘/그룹을 이 앱으로 고정 (다른 PC에서도 안정적으로 아이콘 표시)
        try { SetCurrentProcessExplicitAppUserModelID("WHOSCOFFEE.App"); } catch { }
        // 임베드 어셈블리 로더를 먼저 등록 (WebView2 타입을 쓰기 전에)
        AppDomain.CurrentDomain.AssemblyResolve += OnResolve;
        ExtractNative();
        Run(args);
    }

    // 임베드된 다중해상도 아이콘(AppIcon.ico)을 로드 — DPI별로 Windows 가 적절한 크기 선택
    static Icon LoadAppIcon()
    {
        try
        {
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("AppIcon.ico"))
                if (s != null) return new Icon(s);
        }
        catch { }
        return null;
    }

    // 임베드된 관리 어셈블리(Core/WinForms)를 메모리에서 로드
    static Assembly OnResolve(object sender, ResolveEventArgs e)
    {
        var res = new AssemblyName(e.Name).Name + ".dll";
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(res))
        {
            if (s == null) return null;
            using (var ms = new MemoryStream())
            {
                s.CopyTo(ms);
                return Assembly.Load(ms.ToArray());
            }
        }
    }

    // 네이티브 WebView2Loader.dll 을 임시폴더에 풀고 DLL 검색경로 등록
    static void ExtractNative()
    {
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "WHOSCOFFEE_rt");
            Directory.CreateDirectory(dir);
            var dll = Path.Combine(dir, "WebView2Loader.dll");
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("WebView2Loader.dll"))
            using (var fs = File.Create(dll))
                s.CopyTo(fs);
            SetDllDirectory(dir);
        }
        catch { }
    }

    // WebView2 타입은 이 메서드 안에서만 참조 → Main JIT 시점엔 안 건드림(NoInlining)
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Run(string[] args)
    {
        string url = (args.Length > 0 && args[0].StartsWith("http")) ? args[0] : "__APPURL__";

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var form = new Form
        {
            Text = "WHOSCOFFEE",
            ClientSize = new Size(380, 800),
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedSingle, // 크기 조절 막기
            MaximizeBox = false                            // 최대화 버튼 비활성
        };
        var appIcon = LoadAppIcon();
        if (appIcon != null) form.Icon = appIcon;
        else try { form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        form.Load += async (s, e) =>
        {
            ApplyTitleBar(form); // 타이틀바를 시스템 테마에 맞춤
            try
            {
                string udf = Path.Combine(Path.GetTempPath(), "WHOSCOFFEE.WebView2");
                var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, udf);
                var wv = new Microsoft.Web.WebView2.WinForms.WebView2 { Dock = DockStyle.Fill };
                form.Controls.Add(wv);
                await wv.EnsureCoreWebView2Async(env);
                wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                wv.CoreWebView2.Settings.AreDevToolsEnabled = false;
                // 웹의 미니 모드 토글 → 창 크기 축소/복원 (항상-위는 안 함)
                var normalSize = new Size(380, 800); // 기록 3개까지 여유롭게 (간격 유지)
                // 화면(작업영역)보다 크면 맞춰 축소 — 작은 노트북에서 창이 화면 밖으로 나가지 않게
                try {
                    int maxH = Screen.FromControl(form).WorkingArea.Height - 40;
                    if (normalSize.Height > maxH && maxH > 400) normalSize = new Size(normalSize.Width, maxH);
                } catch { }
                var miniSize = new Size(250, 300);
                wv.CoreWebView2.WebMessageReceived += (s2, e2) =>
                {
                    string msg = null;
                    try { msg = e2.TryGetWebMessageAsString(); } catch { }
                    if (msg == "mini:on") form.ClientSize = miniSize;
                    else if (msg == "mini:off") form.ClientSize = normalSize;
                    else if (msg == "pin:on") form.TopMost = true;   // 항상 위 (미니 전용)
                    else if (msg == "pin:off") form.TopMost = false; // 전체화면·해제 시
                    else if (msg != null && msg.StartsWith("minih:"))
                    {
                        // 웹이 잰 미니 콘텐츠 높이에 창을 맞춤 (하단 여백 최소화). 너비는 미니 고정.
                        int h;
                        if (int.TryParse(msg.Substring(6), out h))
                        {
                            if (h < 200) h = 200;
                            if (h > 460) h = 460;
                            form.ClientSize = new Size(miniSize.Width, h);
                        }
                    }
                };
                // 이 exe의 네이티브 버전을 웹에 주입 → 웹이 최신값과 비교해 업데이트 알림 표시
                // (새 네이티브 빌드 낼 때 이 값 + index.html EXE_LATEST 을 함께 올린다)
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("window.__WC_EXE__='" + APP_VERSION + "';");
                wv.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                try { System.Diagnostics.Process.Start(url); } catch { }
                MessageBox.Show("앱 창 대신 브라우저로 열었어요.\n(" + ex.Message + ")", "WHOSCOFFEE");
                form.Close();
            }
        };

        Application.Run(form);
    }

    // ---- 타이틀바 시스템 테마 연동 ----
    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    static bool IsSystemDark()
    {
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                return k != null && Convert.ToInt32(k.GetValue("AppsUseLightTheme", 1)) == 0;
        }
        catch { return false; }
    }
    static void ApplyTitleBar(Form f)
    {
        int dark = IsSystemDark() ? 1 : 0;
        if (DwmSetWindowAttribute(f.Handle, 20, ref dark, 4) != 0)
            DwmSetWindowAttribute(f.Handle, 19, ref dark, 4);
    }
}
