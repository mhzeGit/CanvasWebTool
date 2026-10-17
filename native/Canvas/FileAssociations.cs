using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Win32;

namespace CanvasNative;

/// <summary>Per-user Windows registration; honors Windows' protected UserChoice default.</summary>
public static class FileAssociations
{
    public const string ProgId="Canvas.Native.Document";
    public static string? UserChoiceProgId()
    {
        if(!OperatingSystem.IsWindows())return null;
        using var choice=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.cvdoc\UserChoice");
        return choice?.GetValue("ProgId") as string;
    }
    public static void ChooseDefaultApp()
    {
        if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException("Default app selection is available on Windows.");
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=Canvas%20Native"){UseShellExecute=true});
    }
    public static string OpenCommand(string executable)=>$"\"{Path.GetFullPath(executable)}\" --open \"%1\"";
    public static string? EffectiveExecutable()
    {
        if(!OperatingSystem.IsWindows())return null;
        uint length=0;AssocQueryString(0,2,".cvdoc",null,null,ref length);
        if(length==0)return null;
        var result=new StringBuilder((int)length);
        return AssocQueryString(0,2,".cvdoc",null,result,ref length)==0?result.ToString():null;
    }
    [SupportedOSPlatform("windows")]
    public static void Register(string executable,bool replace=false)
    {
        executable=Path.GetFullPath(executable);
        if(!File.Exists(executable))throw new FileNotFoundException("Canvas executable was not found.",executable);
        if(!replace)
        {
            using var existing=Registry.CurrentUser.OpenSubKey($@"Software\Classes\{ProgId}\shell\open\command");
            var command=existing?.GetValue("") as string;
            if(command?.StartsWith('"')==true&&command.IndexOf('"',1) is var end&&end>1&&File.Exists(command[1..end]))return;
        }
        Set($@"Software\Classes\{ProgId}","","Canvas Document");
        Set($@"Software\Classes\{ProgId}","FriendlyTypeName","Canvas Document");
        Set($@"Software\Classes\{ProgId}\DefaultIcon","",$"\"{executable}\",0");
        Set($@"Software\Classes\{ProgId}\shell","","open");
        Set($@"Software\Classes\{ProgId}\shell\open\command","",OpenCommand(executable));
        Set(@"Software\Classes\.cvdoc","",ProgId);
        using(var openWith=Registry.CurrentUser.CreateSubKey(@"Software\Classes\.cvdoc\OpenWithProgids"))openWith.SetValue(ProgId,Array.Empty<byte>(),RegistryValueKind.None);
        var app=$@"Software\Classes\Applications\{Path.GetFileName(executable)}";
        Set(app,"FriendlyAppName","Canvas Native");
        Set(app+@"\shell\open\command","",OpenCommand(executable));
        Set(app+@"\SupportedTypes",".cvdoc","");
        Set(@"Software\CanvasNative\Capabilities","ApplicationName","Canvas Native");
        Set(@"Software\CanvasNative\Capabilities","ApplicationDescription","Native Canvas whiteboard and diagram editor");
        Set(@"Software\CanvasNative\Capabilities\FileAssociations",".cvdoc",ProgId);
        Set(@"Software\RegisteredApplications","Canvas Native",@"Software\CanvasNative\Capabilities");
        // Wait for Explorer to receive the association-change notification before exiting.
        SHChangeNotify(0x08000000,0x1000,IntPtr.Zero,IntPtr.Zero);
    }
    [SupportedOSPlatform("windows")]
    private static void Set(string path,string name,string value){using var key=Registry.CurrentUser.CreateSubKey(path);key.SetValue(name,value,RegistryValueKind.String);}
    [DllImport("Shlwapi.dll",CharSet=CharSet.Unicode)]
    private static extern uint AssocQueryString(uint flags,uint str,string association,string? extra,StringBuilder? output,ref uint length);
    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint eventId,uint flags,IntPtr item1,IntPtr item2);
}
