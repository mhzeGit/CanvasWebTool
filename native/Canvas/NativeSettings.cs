using System.Text.Json;
namespace CanvasNative;

public sealed class NativeSettings
{
    public string Theme {get;set;}="dark";
    public string DarkBackground {get;set;}="#101010";
    public string DarkGrid {get;set;}="#191919";
    public string LightBackground {get;set;}="#e8e8e8";
    public string LightGrid {get;set;}="#c8c8c8";
    public string[] Palette {get;set;}=["#c0392b","#d35400","#27ae60","#2980b9","#8e44ad","#16a085","#e67e22","#1abc9c","#34495e","#7f8c8d"];
    public bool Snap {get;set;}
    public bool AutoSave {get;set;}=true;
    public double Width {get;set;}=1440;
    public double Height {get;set;}=900;
    public double PanelWidth {get;set;}=345;
    public static string DirectoryPath=>Environment.GetEnvironmentVariable("CANVASWEBTOOL_STATE_DIR")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".canvaswebtool");
    public static string RecoveryPath=>Path.Combine(DirectoryPath,"native-recovery.cvdoc");
    public static NativeSettings Load()
    {
        if(Program.Arguments.Contains("--test-mode"))return new();
        try{var settings=JsonSerializer.Deserialize<NativeSettings>(File.ReadAllText(Path.Combine(DirectoryPath,"native-settings.json")))??new();settings.Width=Math.Clamp(settings.Width,720,4000);settings.Height=Math.Clamp(settings.Height,480,2500);settings.PanelWidth=Math.Clamp(settings.PanelWidth,220,700);return settings;}catch{return new();}
    }
    public void Save(){if(Program.Arguments.Contains("--test-mode"))return;Directory.CreateDirectory(DirectoryPath);var path=Path.Combine(DirectoryPath,"native-settings.json");File.WriteAllText(path+".tmp",JsonSerializer.Serialize(this));File.Move(path+".tmp",path,true);}
}
