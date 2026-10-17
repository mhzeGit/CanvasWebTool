using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace CanvasNative;

internal static class Program
{
    public static string[] Arguments = [];
    [STAThread]
    public static void Main(string[] args)
    {
        Arguments = args;
        if(args.Contains("--register-file-associations")||args.Contains("--choose-default-app"))
        {
            if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException("File associations are registered on Windows.");
            FileAssociations.Register(Environment.ProcessPath!,replace:true);
            Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new{registered=true,extension=".cvdoc",executable=Environment.ProcessPath,effectiveExecutable=FileAssociations.EffectiveExecutable(),userChoiceProgId=FileAssociations.UserChoiceProgId()}));
            if(args.Contains("--choose-default-app"))FileAssociations.ChooseDefaultApp();
            return;
        }
        if(!args.Contains("--background")&&!args.Contains("--test-mode"))
        {
            if(OperatingSystem.IsWindows()&&Environment.GetEnvironmentVariable("CANVASWEBTOOL_STATE_DIR")==null)
            {
                try{FileAssociations.Register(Environment.ProcessPath!);}catch(Exception error)when(error is IOException or UnauthorizedAccessException or System.Security.SecurityException){System.Diagnostics.Trace.WriteLine(error.Message);}
            }
            var file=args.FirstOrDefault(a=>!a.StartsWith('-')&&(a.EndsWith(".cvdoc",StringComparison.OrdinalIgnoreCase)||a.EndsWith(".json",StringComparison.OrdinalIgnoreCase)));
            if(ShellActivation.TryForward(file))return;
        }
        AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace().StartWithClassicDesktopLifetime(args);
    }
}

public partial class App : Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);
    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.MainWindow = new MainWindow();
        base.OnFrameworkInitializationCompleted();
    }
}
